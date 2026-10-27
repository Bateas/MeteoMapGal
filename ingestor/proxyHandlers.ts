import type http from 'node:http';
import { log } from './logger.js';
import { SERVER_USER_AGENT } from '../src/config/serverIdentity.js';
import { pruneCache } from './requestGuards.js';
import { corsHeaders, error } from './httpHelpers.js';
import { singleFlight } from './singleFlight.js';
import { FIRMS_PRODUCTS, mergeFirmsCsv } from '../src/services/fireService.js';

// ── Proxy Configuration ──────────────────────────────────
const AEMET_API_KEY = process.env.AEMET_API_KEY || '';
const AEMET_BASE = 'https://opendata.aemet.es/opendata';
const METEOSIX_API_KEY = process.env.METEOSIX_API_KEY || '';
const METEOSIX_BASE = 'https://servizos.meteogalicia.gal/apiv5';
const OBSCOSTEIRO_API_KEY = process.env.OBSCOSTEIRO_API_KEY || '';
const OBSCOSTEIRO_BASE = 'https://apis-ext.xunta.gal/mgplatpubapi/v1/api';
const FIRMS_API_KEY = process.env.FIRMS_API_KEY || '';
const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const FIRMS_BBOX = '-10.5,40.8,-6.0,44.5';

// ── AEMET proxy (server-side key injection) ────────────
const aemetCache = new Map<string, { data: Buffer; contentType: string; ts: number }>();
const AEMET_CACHE_TTL = 5 * 60_000; // 5 minutes

/**
 * How long a copy is kept AFTER it stops being fresh, so it can still be
 * served when the provider fails.
 *
 * These caches used to be pruned at their freshness TTL, and every successful
 * answer triggers a prune — observations refresh every few minutes — so the
 * "serve the last good copy if the provider fails" path almost never had a
 * copy to serve. Freshness is still decided at read time by each TTL; this
 * only decides when a copy is thrown away.
 */
const STALE_KEEP_MS = 48 * 3600_000;

/**
 * Negative cache: how long a resource that just failed is left alone.
 *
 * The caches here only keep GOOD answers, so with the provider failing, every request that
 * arrived after the TTL asked it again (singleFlight only joins the requests in flight at the
 * same moment): with traffic, one ask every few seconds at a provider already in trouble, and
 * AEMET and MeteoGalicia both watch for that. Now a failure is remembered per resource for
 * 1 min, doubling while it keeps failing up to 5 min. Meanwhile the last good copy is served
 * (STALE) or, without one, an error, both without asking. The first good answer clears it.
 */
export const DOWN_FIRST_MS = 60_000;
export const DOWN_MAX_MS = 5 * 60_000;
/** A lone failure under `graceFirst` is forgotten after this long. */
export const GRACE_WINDOW_MS = 10 * 60_000;

export interface DownState {
  /** Upstream status of the last failure (0 = no answer at all). */
  status: number;
  remainingMs: number;
}

export function createDownMemo(clock: () => number = () => Date.now(), maxEntries = 500) {
  const entries = new Map<string, { until: number; streak: number; status: number }>();
  return {
    /** The pause still running for this resource, or null. */
    downFor(key: string): DownState | null {
      const e = entries.get(key);
      if (!e) return null;
      const remainingMs = e.until - clock();
      return remainingMs > 0 ? { status: e.status, remainingMs } : null;
    },
    /**
     * Remembers a failure; says how long the pause is and whether it opened a run of failures.
     * With `graceFirst`, a lone failure is only noted and the pause starts at the second one in a
     * row (within GRACE_WINDOW_MS): for answers known to fail now and work a moment later.
     */
    noteFailure(key: string, status: number, graceFirst = false): { pauseMs: number; first: boolean } {
      const now = clock();
      let prev = entries.get(key);
      if (prev && prev.streak === 0 && now - prev.until > GRACE_WINDOW_MS) prev = undefined;
      if (graceFirst && !prev) {
        entries.set(key, { until: now, streak: 0, status });
        return { pauseMs: 0, first: false };
      }
      const streak = (prev?.streak ?? 0) + 1;
      const pauseMs = Math.min(DOWN_MAX_MS, DOWN_FIRST_MS * 2 ** (streak - 1));
      entries.delete(key); // re-insert at the end: the oldest entry is the one dropped
      entries.set(key, { until: now + pauseMs, streak, status });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
      return { pauseMs, first: streak === 1 };
    },
    noteSuccess(key: string): void {
      entries.delete(key);
    },
  };
}

const upstreamDown = createDownMemo();

/**
 * Status we answer for a provider's answer: its 5xx as 502. A 503 or 500 from us read as our
 * own server failing (the 5xx alerts counted MeteoSIX's 503s as ours); 502 says a provider
 * behind us failed. Its 2xx/4xx go out as they came.
 */
export function gatewayStatus(upstreamStatus: number): number {
  return upstreamStatus >= 500 ? 502 : upstreamStatus;
}

/** Status for a paused resource with no copy: a 4xx (bad key, unknown path) as it came, else 502. */
export function downStatus(upstreamStatus: number): number {
  return upstreamStatus >= 400 && upstreamStatus < 500 ? upstreamStatus : 502;
}

function noteUpstreamFailure(label: string, key: string, status: number, graceFirst = false): void {
  const { pauseMs, first } = upstreamDown.noteFailure(key, status, graceFirst);
  if (pauseMs === 0) {
    log.debug(`${label} ${key}: failed once; the next failure in a row pauses it`);
    return;
  }
  const what = key.length > 120 ? `${key.slice(0, 120)}...` : key;
  const msg = `${label} ${what}: ${status ? `HTTP ${status}` : 'no answer'}; not asking again for ${Math.round(pauseMs / 1000)} s (last good copy or an error meanwhile)`;
  if (first) log.warn(msg);
  else log.debug(msg);
}

/** The provider's answer and body; a request that gets no answer at all is noted as a failure. */
async function fetchBody(url: string, init: RequestInit, label: string, downKey: string): Promise<{ upstream: Response; buf: Buffer }> {
  try {
    const upstream = await fetch(url, init);
    const buf = Buffer.from(await upstream.arrayBuffer());
    return { upstream, buf };
  } catch (err) {
    noteUpstreamFailure(label, downKey, 0);
    throw err;
  }
}

/** Answer for a paused resource: the last good copy if there is one, otherwise an error. Never the provider. */
function answerWhileDown(
  res: http.ServerResponse,
  origin: string | undefined,
  cached: { data: Buffer; contentType: string } | null | undefined,
  down: DownState,
  label: string,
): void {
  if (cached) {
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'STALE' });
    res.end(cached.data);
    return;
  }
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil(down.remainingMs / 1000))));
  res.setHeader('X-Cache', 'DOWN');
  error(res, `${label} upstream unavailable (failed recently)`, downStatus(down.status), origin);
}

/** The station inventory barely changes: a long TTL costs nothing. */
export const AEMET_INVENTORY_TTL = 12 * 3600_000;

export function aemetTtlFor(path: string): number {
  return path.includes('/inventarioestaciones/') ? AEMET_INVENTORY_TTL : AEMET_CACHE_TTL;
}

/**
 * Whether an AEMET answer is a real answer. AEMET reports its own failures
 * as HTTP 200 with a body like {"estado": 429, ...}; caching one of those
 * would serve the failure to everyone for the whole TTL — twelve hours for
 * the inventory. Data payloads are arrays, so only an object carrying an
 * `estado` other than 200 is a failure. Reads the first bytes only: the
 * observation payload is megabytes and is checked every five minutes.
 */
export function aemetAnswerOk(body: Buffer): boolean {
  const head = body.subarray(0, 300).toString('latin1').trimStart();
  if (!head.startsWith('{')) return true;
  const m = /"estado"\s*:\s*(\d+)/.exec(head);
  return !m || m[1] === '200';
}

/**
 * The step-two paths an AEMET step-one answer points at, in the form the
 * data route receives them (`/opendata/sh/<code>`).
 */
export function aemetDataPaths(body: Buffer): string[] {
  try {
    const j = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    const out: string[] = [];
    for (const k of ['datos', 'metadatos']) {
      const v = j?.[k];
      if (typeof v !== 'string') continue;
      const u = new URL(v);
      if (u.hostname === 'opendata.aemet.es') out.push(u.pathname);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Step two goes to a temporary url that changes on every step-one answer, so
 * caching it by url stored nothing reusable: every copy was of a link nobody
 * would ask for again. This remembers which step-one resource each temporary
 * path belongs to, and the data is cached under THAT, one entry per resource,
 * overwritten on each refresh.
 */
const aemetDataOrigin = new Map<string, string>();

function rememberDataOrigin(stepOnePath: string, body: Buffer): void {
  const paths = aemetDataPaths(body);
  paths.forEach((p, i) => aemetDataOrigin.set(p, i === 0 ? stepOnePath : `${stepOnePath}#meta`));
  while (aemetDataOrigin.size > 500) {
    aemetDataOrigin.delete(aemetDataOrigin.keys().next().value as string);
  }
}

export async function handleAemetProxy(
  aemetPath: string,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  if (!AEMET_API_KEY) {
    error(res, 'AEMET_API_KEY not configured on server', 503, origin);
    return;
  }

  // Whitelist allowed AEMET paths to prevent SSRF
  if (!aemetPath.startsWith('/api/') && !aemetPath.startsWith('/opendata/')) {
    error(res, 'Invalid AEMET path', 400, origin);
    return;
  }

  // Check in-memory cache
  const ttl = aemetTtlFor(aemetPath);
  const cached = aemetCache.get(aemetPath);
  if (cached && Date.now() - cached.ts < ttl) {
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'HIT' });
    res.end(cached.data);
    return;
  }

  // Failed a moment ago: do not ask again yet (see createDownMemo).
  const downKey = `aemet:${aemetPath}`;
  const down = upstreamDown.downFor(downKey);
  if (down) {
    answerWhileDown(res, origin, cached, down, 'AEMET');
    return;
  }

  try {
    // One ask per path at a time: a crowd on a cold cache costs AEMET one
    // request, not one each.
    const { value, joined } = await singleFlight(downKey, async () => {
      // Inject api_key server-side
      const sep = aemetPath.includes('?') ? '&' : '?';
      const url = `${AEMET_BASE}${aemetPath}${sep}api_key=${AEMET_API_KEY}`;
      // AEMET is the one that hangs rather than failing, and now that the
      // answer is shared a hang without a deadline would hang everyone
      // waiting on it instead of only the first.
      const { upstream, buf } = await fetchBody(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      }, '[AEMET Proxy]', downKey);
      const contentType = upstream.headers.get('content-type') || 'application/json';

      // Cache real answers only (see aemetAnswerOk)
      const good = upstream.ok && aemetAnswerOk(buf);
      if (good) {
        aemetCache.set(aemetPath, { data: buf, contentType, ts: Date.now() });
        rememberDataOrigin(aemetPath, buf);
        pruneCache(aemetCache, STALE_KEEP_MS, 50);
        upstreamDown.noteSuccess(downKey);
      } else {
        noteUpstreamFailure('[AEMET Proxy]', downKey, upstream.ok ? 502 : upstream.status);
      }

      return { status: upstream.status, contentType, buf, good };
    });

    // AEMET answered, but with a failure: the last good copy beats passing
    // the failure on to the visitor.
    if (!value.good && cached) {
      res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'STALE' });
      res.end(cached.data);
      return;
    }

    res.writeHead(gatewayStatus(value.status), { ...corsHeaders(origin), 'Content-Type': value.contentType, 'X-Cache': joined ? 'JOINED' : 'MISS' });
    res.end(value.buf);
  } catch (err) {
    log.error('[AEMET Proxy]', (err as Error).message);
    // Serve stale cache on error
    if (cached) {
      res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'STALE' });
      res.end(cached.data);
      return;
    }
    error(res, 'AEMET upstream error', 502, origin);
  }
}

// ── NASA FIRMS proxy (active wildfires) ──────────────────
const firmsCache = new Map<number, { data: Buffer; ts: number }>();
const FIRMS_CACHE_TTL = 30 * 60_000; // 30 minutes
const FIRMS_TIMEOUT_MS = 10_000;

export async function handleFirmsProxy(
  daysParam: string | null,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  if (!FIRMS_API_KEY) {
    error(res, 'FIRMS_API_KEY not configured on server', 503, origin);
    return;
  }

  // Validate days: 1..5 (FIRMS Area-API limit)
  const days = Math.max(1, Math.min(5, parseInt(daysParam || '1', 10) || 1));

  const cached = firmsCache.get(days);
  if (cached && Date.now() - cached.ts < FIRMS_CACHE_TTL) {
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': 'text/csv', 'X-Cache': 'HIT' });
    res.end(cached.data);
    return;
  }

  try {
    // Each ask here is three requests to NASA (one per platform), so sharing
    // it matters three times over.
    const { value: buf, joined } = await singleFlight(`firms:${days}`, async () => {
      const results = await Promise.all(
        FIRMS_PRODUCTS.map(async (product) => {
          try {
            const url = `${FIRMS_BASE}/${FIRMS_API_KEY}/${product}/${FIRMS_BBOX}/${days}`;
            const r = await fetch(url, { signal: AbortSignal.timeout(FIRMS_TIMEOUT_MS) });
            if (!r.ok) {
              log.warn(`[FIRMS Proxy] ${product} upstream ${r.status}`);
              return null;
            }
            return await r.text();
          } catch (err) {
            log.warn(`[FIRMS Proxy] ${product} failed: ${(err as Error).message}`);
            return null;
          }
        }),
      );

      const merged = mergeFirmsCsv(results);
      if (!merged) throw new Error('all FIRMS platforms failed');
      const data = Buffer.from(merged, 'utf8');

      firmsCache.set(days, { data, ts: Date.now() });
      if (firmsCache.size > 10) {
        const now = Date.now();
        for (const [k, v] of firmsCache) {
          if (now - v.ts > FIRMS_CACHE_TTL) firmsCache.delete(k);
        }
      }

      return data;
    });

    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': 'text/csv', 'X-Cache': joined ? 'JOINED' : 'MISS' });
    res.end(buf);
  } catch (err) {
    log.error('[FIRMS Proxy]', (err as Error).message);
    if (cached) {
      res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': 'text/csv', 'X-Cache': 'STALE' });
      res.end(cached.data);
      return;
    }
    error(res, 'FIRMS upstream error', 502, origin);
  }
}

// ── AEMET data proxy (step 2 — signed URLs) ────────────
export async function handleAemetDataProxy(
  dataPath: string,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  // Cached under the resource it belongs to, not under the temporary url.
  const stepOne = aemetDataOrigin.get(dataPath);
  const key = `data:${stepOne ?? dataPath}`;
  const ttl = stepOne ? aemetTtlFor(stepOne) : AEMET_CACHE_TTL;
  const cached = aemetCache.get(key);
  if (cached && Date.now() - cached.ts < ttl) {
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'HIT' });
    res.end(cached.data);
    return;
  }

  // Paused per RESOURCE (the step-one path), not per temporary url: each step-one answer
  // brings a new url, so a pause keyed by url would never be found again.
  const downKey = `aemet-${key}`;
  const down = upstreamDown.downFor(downKey);
  if (down) {
    answerWhileDown(res, origin, cached, down, 'AEMET data');
    return;
  }

  try {
    const { value, joined } = await singleFlight(`aemet-data:${dataPath}`, async () => {
      const url = `https://opendata.aemet.es${dataPath}`;
      const { upstream, buf } = await fetchBody(url, { signal: AbortSignal.timeout(15_000) }, '[AEMET Data Proxy]', downKey);
      const contentType = upstream.headers.get('content-type') || 'application/json';

      const good = upstream.ok && aemetAnswerOk(buf);
      if (good) {
        aemetCache.set(key, { data: buf, contentType, ts: Date.now() });
        pruneCache(aemetCache, STALE_KEEP_MS, 50);
        upstreamDown.noteSuccess(downKey);
      } else if (upstream.ok || upstream.status === 429 || upstream.status >= 500) {
        // A 4xx other than 429 is an expired or made-up temporary url, chosen by whoever asked:
        // counting it would let one request pause the whole resource for every visitor.
        noteUpstreamFailure('[AEMET Data Proxy]', downKey, upstream.ok ? 502 : upstream.status);
      }

      return { status: upstream.status, contentType, buf, good };
    });

    if (!value.good && cached) {
      res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'STALE' });
      res.end(cached.data);
      return;
    }

    res.writeHead(gatewayStatus(value.status), { ...corsHeaders(origin), 'Content-Type': value.contentType, 'X-Cache': joined ? 'JOINED' : 'MISS' });
    res.end(value.buf);
  } catch (err) {
    log.error('[AEMET Data Proxy]', (err as Error).message);
    if (cached) {
      res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'STALE' });
      res.end(cached.data);
      return;
    }
    error(res, 'AEMET data upstream error', 502, origin);
  }
}

// ── MeteoSIX proxy (server-side key injection) ─────────
const meteosixCache = new Map<string, { data: Buffer; contentType: string; ts: number }>();
// The WRF runs twice a day and the ingestor itself keeps it 60 min: a 3-min
// TTL sent up to 480 requests a day per URL to MeteoGalicia for the same run.
const METEOSIX_CACHE_TTL = 60 * 60_000;
/** Lets the edge share one copy among visitors; good answers only. */
const METEOSIX_EDGE_CACHE = 'public, max-age=600';

const MS_ALLOWED_PATHS = new Set(['/getNumericForecastInfo', '/getTidesInfo']);

/** True for MeteoSIX's error answer, a top-level `{"exception": ...}` object. */
export function isMeteoSixErrorEnvelope(body: Buffer): boolean {
  return /^\s*\{\s*"exception"\s*:/.test(body.subarray(0, 64).toString('utf8'));
}

export async function handleMeteoSixProxy(
  msPath: string,
  query: string,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  if (!METEOSIX_API_KEY) {
    error(res, 'METEOSIX_API_KEY not configured on server', 503, origin);
    return;
  }

  // Exact operations only: the key is ours and must not sign arbitrary paths.
  // getTidesInfo is the stand-in tide table for when the IHM is down.
  if (!MS_ALLOWED_PATHS.has(msPath)) {
    error(res, 'Invalid MeteoSIX path', 400, origin);
    return;
  }

  const cacheKey = `${msPath}?${query}`;
  const cached = meteosixCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < METEOSIX_CACHE_TTL) {
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'Cache-Control': METEOSIX_EDGE_CACHE, 'X-Cache': 'HIT' });
    res.end(cached.data);
    return;
  }

  const downKey = `meteosix:${cacheKey}`;
  const down = upstreamDown.downFor(downKey);
  if (down) {
    answerWhileDown(res, origin, cached, down, 'MeteoSIX');
    return;
  }

  try {
    const { value, joined } = await singleFlight(downKey, async () => {
      const sep = query ? '&' : '';
      const url = `${METEOSIX_BASE}${msPath}?${query}${sep}API_KEY=${METEOSIX_API_KEY}`;
      const { upstream, buf } = await fetchBody(url, { headers: { Accept: 'application/json', 'User-Agent': SERVER_USER_AGENT }, signal: AbortSignal.timeout(15_000) }, '[MeteoSIX Proxy]', downKey);
      const contentType = upstream.headers.get('content-type') || 'application/json';

      // MeteoSIX reports its own failures as 200 + {"exception": ...}. Caching
      // one would serve that error to every visitor for the whole TTL.
      const good = upstream.ok && !isMeteoSixErrorEnvelope(buf);
      if (good) {
        meteosixCache.set(cacheKey, { data: buf, contentType, ts: Date.now() });
        pruneCache(meteosixCache, STALE_KEEP_MS, 100);
        upstreamDown.noteSuccess(downKey);
      } else {
        // The error envelope comes and goes for the same query (src/api/CLAUDE.md) and the tide
        // client retries it once: a lone envelope does not pause the query, a second one does.
        noteUpstreamFailure('[MeteoSIX Proxy]', downKey, upstream.ok ? 502 : upstream.status, upstream.ok);
      }

      return { status: upstream.status, contentType, buf, good };
    });

    if (!value.good && cached) {
      res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'STALE' });
      res.end(cached.data);
      return;
    }

    res.writeHead(gatewayStatus(value.status), {
      ...corsHeaders(origin),
      'Content-Type': value.contentType,
      'Cache-Control': value.good ? METEOSIX_EDGE_CACHE : 'no-store',
      'X-Cache': joined ? 'JOINED' : 'MISS',
    });
    res.end(value.buf);
  } catch (err) {
    log.error('[MeteoSIX Proxy]', (err as Error).message);
    if (cached) {
      res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'STALE' });
      res.end(cached.data);
      return;
    }
    error(res, 'MeteoSIX upstream error', 502, origin);
  }
}

// ── ObsCosteiro proxy (server-side key injection) ───────
const obsCache = new Map<string, { data: Buffer; contentType: string; ts: number }>();
const OBS_CACHE_TTL = 3 * 60_000;

export async function handleObsCosteiroProxy(
  obsPath: string,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  if (!OBSCOSTEIRO_API_KEY) {
    error(res, 'OBSCOSTEIRO_API_KEY not configured on server', 503, origin);
    return;
  }

  if (!obsPath.startsWith('/ultimo/')) {
    error(res, 'Invalid ObsCosteiro path', 400, origin);
    return;
  }

  const cached = obsCache.get(obsPath);
  if (cached && Date.now() - cached.ts < OBS_CACHE_TTL) {
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'HIT' });
    res.end(cached.data);
    return;
  }

  const downKey = `obscosteiro:${obsPath}`;
  const down = upstreamDown.downFor(downKey);
  if (down) {
    answerWhileDown(res, origin, cached, down, 'ObsCosteiro');
    return;
  }

  try {
    const { value, joined } = await singleFlight(downKey, async () => {
      const url = `${OBSCOSTEIRO_BASE}${obsPath}`;
      const { upstream, buf } = await fetchBody(url, {
        headers: { apikey: OBSCOSTEIRO_API_KEY, Accept: 'application/json', 'User-Agent': SERVER_USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      }, '[ObsCosteiro Proxy]', downKey);
      const contentType = upstream.headers.get('content-type') || 'application/json';

      const good = upstream.ok;
      if (good) {
        obsCache.set(obsPath, { data: buf, contentType, ts: Date.now() });
        pruneCache(obsCache, STALE_KEEP_MS, 50);
        upstreamDown.noteSuccess(downKey);
      } else {
        noteUpstreamFailure('[ObsCosteiro Proxy]', downKey, upstream.status);
      }

      return { status: upstream.status, contentType, buf, good };
    });

    if (!value.good && cached) {
      res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'STALE' });
      res.end(cached.data);
      return;
    }

    res.writeHead(gatewayStatus(value.status), { ...corsHeaders(origin), 'Content-Type': value.contentType, 'X-Cache': joined ? 'JOINED' : 'MISS' });
    res.end(value.buf);
  } catch (err) {
    log.error('[ObsCosteiro Proxy]', (err as Error).message);
    if (cached) {
      res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'STALE' });
      res.end(cached.data);
      return;
    }
    error(res, 'ObsCosteiro upstream error', 502, origin);
  }
}

// ── METAR proxy (aviationweather.gov) ──────────────────
const METAR_URL = 'https://aviationweather.gov/api/data/metar?ids=LEVX,LEST,LECO&format=json';
const METAR_CACHE_TTL = 5 * 60_000; // 5 minutes
let metarCache: { data: Buffer; contentType: string; ts: number } | null = null;

export async function handleMetarProxy(
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  if (metarCache && Date.now() - metarCache.ts < METAR_CACHE_TTL) {
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': metarCache.contentType, 'X-Cache': 'HIT' });
    res.end(metarCache.data);
    return;
  }

  try {
    const { value, joined } = await singleFlight('metar', async () => {
      const upstream = await fetch(METAR_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      const contentType = upstream.headers.get('content-type') || 'application/json';
      const buf = Buffer.from(await upstream.arrayBuffer());

      if (upstream.ok) {
        metarCache = { data: buf, contentType, ts: Date.now() };
      }

      return { status: upstream.status, contentType, buf };
    });

    res.writeHead(gatewayStatus(value.status), { ...corsHeaders(origin), 'Content-Type': value.contentType, 'X-Cache': joined ? 'JOINED' : 'MISS' });
    res.end(value.buf);
  } catch (err) {
    log.error('[METAR Proxy]', (err as Error).message);
    if (metarCache) {
      res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': metarCache.contentType, 'X-Cache': 'STALE' });
      res.end(metarCache.data);
      return;
    }
    error(res, 'METAR upstream error', 502, origin);
  }
}
