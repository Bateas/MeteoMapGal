import type http from 'node:http';
import { log } from './logger.js';
import { pruneCache } from './requestGuards.js';
import { corsHeaders, error } from './httpHelpers.js';
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
  const cached = aemetCache.get(aemetPath);
  if (cached && Date.now() - cached.ts < AEMET_CACHE_TTL) {
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'HIT' });
    res.end(cached.data);
    return;
  }

  try {
    // Inject api_key server-side
    const sep = aemetPath.includes('?') ? '&' : '?';
    const url = `${AEMET_BASE}${aemetPath}${sep}api_key=${AEMET_API_KEY}`;
    const upstream = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    const contentType = upstream.headers.get('content-type') || 'application/json';
    const buf = Buffer.from(await upstream.arrayBuffer());

    // Cache successful responses
    if (upstream.ok) {
      aemetCache.set(aemetPath, { data: buf, contentType, ts: Date.now() });
      pruneCache(aemetCache, AEMET_CACHE_TTL, 50);
    }

    res.writeHead(upstream.status, { ...corsHeaders(origin), 'Content-Type': contentType, 'X-Cache': 'MISS' });
    res.end(buf);
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
    const buf = Buffer.from(merged, 'utf8');

    firmsCache.set(days, { data: buf, ts: Date.now() });
    if (firmsCache.size > 10) {
      const now = Date.now();
      for (const [k, v] of firmsCache) {
        if (now - v.ts > FIRMS_CACHE_TTL) firmsCache.delete(k);
      }
    }

    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': 'text/csv', 'X-Cache': 'MISS' });
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
  const cached = aemetCache.get(`data:${dataPath}`);
  if (cached && Date.now() - cached.ts < AEMET_CACHE_TTL) {
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'HIT' });
    res.end(cached.data);
    return;
  }

  try {
    const url = `https://opendata.aemet.es${dataPath}`;
    const upstream = await fetch(url);
    const contentType = upstream.headers.get('content-type') || 'application/json';
    const buf = Buffer.from(await upstream.arrayBuffer());

    if (upstream.ok) {
      aemetCache.set(`data:${dataPath}`, { data: buf, contentType, ts: Date.now() });
    }

    res.writeHead(upstream.status, { ...corsHeaders(origin), 'Content-Type': contentType, 'X-Cache': 'MISS' });
    res.end(buf);
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
const METEOSIX_CACHE_TTL = 3 * 60_000;

const MS_ALLOWED_PATHS = new Set(['/getNumericForecastInfo', '/getTidesInfo']);

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
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'HIT' });
    res.end(cached.data);
    return;
  }

  try {
    const sep = query ? '&' : '';
    const url = `${METEOSIX_BASE}${msPath}?${query}${sep}API_KEY=${METEOSIX_API_KEY}`;
    const upstream = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    const contentType = upstream.headers.get('content-type') || 'application/json';
    const buf = Buffer.from(await upstream.arrayBuffer());

    if (upstream.ok) {
      meteosixCache.set(cacheKey, { data: buf, contentType, ts: Date.now() });
      pruneCache(meteosixCache, METEOSIX_CACHE_TTL, 100);
    }

    res.writeHead(upstream.status, { ...corsHeaders(origin), 'Content-Type': contentType, 'X-Cache': 'MISS' });
    res.end(buf);
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

  try {
    const url = `${OBSCOSTEIRO_BASE}${obsPath}`;
    const upstream = await fetch(url, {
      headers: { apikey: OBSCOSTEIRO_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = upstream.headers.get('content-type') || 'application/json';
    const buf = Buffer.from(await upstream.arrayBuffer());

    if (upstream.ok) {
      obsCache.set(obsPath, { data: buf, contentType, ts: Date.now() });
      pruneCache(obsCache, OBS_CACHE_TTL, 50);
    }

    res.writeHead(upstream.status, { ...corsHeaders(origin), 'Content-Type': contentType, 'X-Cache': 'MISS' });
    res.end(buf);
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
    const upstream = await fetch(METAR_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = upstream.headers.get('content-type') || 'application/json';
    const buf = Buffer.from(await upstream.arrayBuffer());

    if (upstream.ok) {
      metarCache = { data: buf, contentType, ts: Date.now() };
    }

    res.writeHead(upstream.status, { ...corsHeaders(origin), 'Content-Type': contentType, 'X-Cache': 'MISS' });
    res.end(buf);
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
