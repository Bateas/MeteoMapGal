/**
 * Lightning fetcher.
 *
 * Reads MeteoGalicia's official lightning JSON (`jsonRaios.action`, listed on their RSS/JSON
 * services page) and writes every strike into the `lightning_strikes` hypertable. Runs 24/7 in
 * the ingestor; the map and the lightning alert read the table, never the provider.
 *
 * Until v2.178.22 this read meteo2api (its `lenda` feed), the service behind MeteoGalicia's own web.
 * They asked on 2-oct-2026 that third-party apps use their JSON services instead, and on 9-oct
 * that nobody ask for lightning more than once every 5 minutes (they publish with ~5 min of delay).
 * The switch was checked strike by strike on the storm of 6-oct: 9,466 of the official 9,467
 * strikes are in our table with the same minute, position and current (the extra one shares
 * minute and position with another, which the minute key merges). The official service gives
 * the time to the second, but the table keeps the MINUTE, as it always has: the PK is (time, lat,
 * lon), so storing seconds would insert again every strike already stored at the minute (the
 * whole day of the switch, or any re-asked day) and mix two precisions in the archive. Seconds
 * are only used in memory, to measure how late strikes are published.
 *
 * The service answers whole UTC days: no parameters = today; `dataIni`/`dataFin` (dd/mm/yyyy,
 * up to 7 days) = a range. We ask for today, and for yesterday too right after a restart or in
 * the first half hour of the UTC day, so the strikes of 23:55 published at 00:01 are not lost.
 * Dedup is the PK (time, lat, lon) + ON CONFLICT DO NOTHING, so asking again is free.
 *
 * Why persist raw strikes: the map keeps ~60 min in memory; without lat/lon/time history there
 * is no heatmap, no storm-path study and no ground truth for the storm predictor.
 */

import { getPool } from './db.js';
import { log } from './logger.js';
import {
  isOpen as isLightningBreakerOpen,
  reportFailure as reportLightningFailure,
  reportSuccess as reportLightningSuccess,
} from './lightningBreaker.js';

const JSON_RAIOS_URL = 'https://servizos.meteogalicia.gal/mgrss/observacion/jsonRaios.action';
/** A storm day is ~730 KB (6-oct: 9,467 strikes), answered in under a second. */
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; MeteoMapGal/1.0; +https://meteomapgal.navia3d.com)';
/** Also ask for yesterday this long after 00:00 UTC (covers the ~5 min publishing delay with margin). */
const DAY_EDGE_MS = 30 * 60_000;
/** Rows per INSERT: 7 parameters each, and PostgreSQL takes at most 65,535 per statement. */
const INSERT_CHUNK = 1000;

// ── Types ─────────────────────────────────────────────

/** One strike as the official service gives it. `peakCurrent` is signed (negative = negative strike). */
export interface JsonRaio { time: Date; lat: number; lon: number; peakCurrent: number | null }

export interface PersistedStrike {
  time: Date;
  lat: number;
  lon: number;
  peakCurrent: number;
  cloudToCloud: boolean;
  multiplicity: number;
  /** Inside the Galicia + relevant-buffer bbox (see GALICIA_SCOPE). */
  isGalicia: boolean;
}

/**
 * Geographic scope for "relevant" lightning. The service returns strikes for the whole NW
 * Iberian peninsula; ~32% (audited 2026-05-14) fall outside the area that actually affects
 * Galician weather (Castilla interior, deep Portugal, Asturias). We KEEP those rows
 * (storm-approach analysis may want them) but flag them so the predictor / analyzer can
 * calibrate on `WHERE is_galicia = TRUE` only.
 *
 * Bbox rationale:
 *   N 44.5  — Estaca de Bares + ~20km buffer
 *   S 41.5  — northern Portugal down to Aveiro
 *   W -10.5 — ~100km offshore Atlantic (catch oceanic fronts before landfall)
 *   E -6.0  — Ourense interior + León/Zamora border. Wider than the strict
 *             Galicia edge (-6.5) on purpose: an eastern storm at -6.3°W can
 *             move into Ourense within an hour, so the tracker needs to see
 *             it coming. The Macizo Galaico blocks most, but not all.
 */
export const GALICIA_SCOPE = {
  north: 44.5,
  south: 41.5,
  west: -10.5,
  east: -6.0,
} as const;

/** True if a strike is within the Galicia-relevant bbox. Pure + testable. */
export function isInGaliciaScope(lat: number, lon: number): boolean {
  return (
    lat >= GALICIA_SCOPE.south &&
    lat <= GALICIA_SCOPE.north &&
    lon >= GALICIA_SCOPE.west &&
    lon <= GALICIA_SCOPE.east
  );
}

// ── Pure helpers (testable in isolation) ─────────────

/**
 * Parse a jsonRaios.action body: `{raios: [{data, numRaiosTotal, numRaiosGalicia, listaRaios:
 * [{fecha (UTC, no offset), lat, lon, peakCurrent}]}, ...]}`, one element per day asked.
 * Entries without a valid time or position are dropped.
 */
export function parseJsonRaios(body: unknown): JsonRaio[] {
  const days = (body as { raios?: unknown } | null)?.raios;
  if (!Array.isArray(days)) return [];
  const out: JsonRaio[] = [];
  for (const day of days) {
    const list = (day as { listaRaios?: unknown } | null)?.listaRaios;
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      const o = r as Record<string, unknown> | null;
      if (!o) continue;
      const t = typeof o.fecha === 'string' ? Date.parse(o.fecha + 'Z') : NaN;   // documented as UTC
      if (!Number.isFinite(t) || typeof o.lat !== 'number' || typeof o.lon !== 'number') continue;
      if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) continue;
      out.push({ time: new Date(t), lat: o.lat, lon: o.lon, peakCurrent: typeof o.peakCurrent === 'number' ? o.peakCurrent : null });
    }
  }
  return out;
}

/** The persisted shape, time truncated to the minute (see the header). The service gives only
 *  cloud-to-ground strikes (MeteoGalicia offered on 9-oct to add intra-cloud ones with a flag:
 *  when it exists, read it here). */
export function toPersisted(strikes: JsonRaio[]): PersistedStrike[] {
  return strikes.map((s) => ({
    time: new Date(Math.floor(s.time.getTime() / 60_000) * 60_000),
    lat: s.lat,
    lon: s.lon,
    peakCurrent: s.peakCurrent ?? 0,
    cloudToCloud: false,
    multiplicity: 1,
    isGalicia: isInGaliciaScope(s.lat, s.lon),
  }));
}

/** dd/mm/yyyy of the UTC day of `ms`, the format the service takes. */
export function utcDayParam(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/**
 * What to ask for: today, or yesterday and today after a restart (`lastSuccessAt` null), after a
 * poll that missed the day change, or in the first half hour of the UTC day.
 */
export function jsonRaiosUrl(nowMs: number, lastSuccessAt: number | null): string {
  const dayStart = Math.floor(nowMs / 86_400_000) * 86_400_000;
  const needYesterday = lastSuccessAt == null || lastSuccessAt < dayStart + DAY_EDGE_MS || nowMs - dayStart < DAY_EDGE_MS;
  if (!needYesterday) return JSON_RAIOS_URL;
  return `${JSON_RAIOS_URL}?dataIni=${utcDayParam(dayStart - 86_400_000)}&dataFin=${utcDayParam(dayStart)}`;
}

/** Strike activity near Galicia: one in the last 5 min, or five in the last 15 (the same rule the
 *  map uses, with the publishing delay in mind). Only logged since the pace is fixed at 5 min. */
export function isStormActive(strikes: PersistedStrike[], nowMs: number): boolean {
  let n5 = 0, n15 = 0;
  for (const s of strikes) {
    if (!s.isGalicia) continue;
    const age = nowMs - s.time.getTime();
    if (age < 0 || age > 15 * 60_000) continue;
    n15++;
    if (age <= 5 * 60_000) n5++;
  }
  return n5 >= 1 || n15 >= 5;
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ── Fetcher ───────────────────────────────────────────

/** Last poll whose strikes all reached the table. */
let lastSuccessAt: number | null = null;
let lastStormActive = false;
let announced = false;
/** Strikes already seen near Galicia (last 48 h), to measure how late new ones are published. */
const seen = new Map<string, number>();

async function fetchRaios(nowMs: number): Promise<JsonRaio[] | null> {
  // During a sustained outage, skip the fetch silently instead of logging a WARN every cycle.
  if (isLightningBreakerOpen()) return null;
  const url = jsonRaiosUrl(nowMs, lastSuccessAt);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      reportLightningFailure(`HTTP ${res.status}`);
      log.warn(`[Lightning] jsonRaios HTTP ${res.status}`);
      return null;
    }
    const strikes = parseJsonRaios(await res.json());
    reportLightningSuccess();
    if (!announced) {
      log.info('[Lightning] fuente: jsonRaios.action de MeteoGalicia (servicio oficial), cada 5 min');
      announced = true;
    }
    return strikes;
  } catch (err) {
    reportLightningFailure((err as Error).message);
    log.warn(`[Lightning] jsonRaios fetch failed: ${(err as Error).message}`);
    return null;
  }
}

/** Minutes between each strike and the first poll that saw it, for strikes near Galicia not seen
 *  before, with the time to the second. Empty on the first poll after a restart (everything is
 *  "new" then). */
function publishLags(strikes: JsonRaio[], nowMs: number, firstPoll: boolean): number[] {
  const lags: number[] = [];
  for (const s of strikes) {
    if (!isInGaliciaScope(s.lat, s.lon)) continue;
    const k = `${s.time.getTime()}|${s.lat}|${s.lon}`;
    if (seen.has(k)) continue;
    seen.set(k, s.time.getTime());
    if (!firstPoll) lags.push((nowMs - s.time.getTime()) / 60_000);
  }
  for (const [k, t] of seen) if (nowMs - t > 48 * 3_600_000) seen.delete(k);
  return lags;
}

// ── DB persist ────────────────────────────────────────

/** New rows stored, or null when an INSERT failed. */
async function batchInsertStrikes(strikes: PersistedStrike[]): Promise<number | null> {
  if (strikes.length === 0) return 0;
  const db = getPool();
  let inserted = 0;

  // Multi-row INSERT with ON CONFLICT DO NOTHING (PK-based dedup), in chunks: the whole day in
  // one statement went over PostgreSQL's 65,535 parameters past ~9,360 strikes (17-jun: 9,975),
  // and the storm stopped reaching the table, and the lightning alerts, until it aged out.
  for (let i = 0; i < strikes.length; i += INSERT_CHUNK) {
    const chunk = strikes.slice(i, i + INSERT_CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const s of chunk) {
      values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
      params.push(s.time, s.lat, s.lon, s.peakCurrent, s.cloudToCloud, s.multiplicity, s.isGalicia);
    }
    const sql = `
      INSERT INTO lightning_strikes (time, lat, lon, peak_current, cloud_to_cloud, multiplicity, is_galicia)
      VALUES ${values.join(', ')}
      ON CONFLICT (time, lat, lon) DO NOTHING
    `;
    try {
      const result = await db.query(sql, params);
      inserted += result.rowCount ?? 0;
    } catch (err) {
      log.error(`[Lightning] DB insert failed: ${(err as Error).message}`);
      return null;
    }
  }
  return inserted;
}

// ── Public entry ──────────────────────────────────────

/**
 * One poll cycle: today's strikes (and yesterday's at the day edge or after a restart) →
 * persist. Asking again for strikes we already have is a cheap PK no-op.
 *
 * Returns whether there is storm activity near Galicia (logged by index.ts). On a failed poll
 * the last known answer stands.
 */
export async function runLightningCycle(): Promise<{ stormActive: boolean }> {
  const polledAt = Date.now();
  const firstPoll = lastSuccessAt == null;
  const raw = await fetchRaios(polledAt);
  if (!raw) return { stormActive: lastStormActive };

  const strikes = toPersisted(raw);
  lastStormActive = isStormActive(strikes, polledAt);
  const lags = publishLags(raw, polledAt, firstPoll);
  if (strikes.length === 0) {
    lastSuccessAt = polledAt;
    log.debug(`[Lightning] poll ok — 0 strikes`);
    return { stormActive: lastStormActive };
  }

  const inserted = await batchInsertStrikes(strikes);
  if (inserted !== null) lastSuccessAt = polledAt;
  const inScope = strikes.filter((s) => s.isGalicia).length;
  const lagText = lags.length ? ` · ${lags.length} nuevos cerca, publicados con ${Math.round(median(lags))} min de retraso (mediana; max ${Math.round(Math.max(...lags))})` : '';
  log.info(
    `[Lightning] poll ok — ${strikes.length} returned (${inScope} in Galicia scope, ${strikes.length - inScope} buffer), ${inserted ?? 0} new rows persisted${lagText}`,
  );
  return { stormActive: lastStormActive };
}
