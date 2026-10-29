/**
 * The pure half of the live INTECMAR feed (intecmarLive.ts): what to ask api.intecmar.gal every
 * INTECMAR_LIVE_MS, and how its answers become the same buoy row the Observatorio Costeiro path builds
 * from MeteoGalicia's platform API (buoyFetcher.ts, src/api/obsCosteiroParse.ts).
 *
 * Why: on 21-oct-2026 INTECMAR told us in writing that the Observatorio Costeiro platforms are no longer
 * offered through MeteoGalicia, only through api.intecmar.gal; and MeteoGalicia's «latest» endpoint
 * loses whole bursts of Cortegada (166 of 288 instants on 18-19 oct, against 288 of 288 at INTECMAR).
 *
 * The reading follows the same rules as readObsCurrent, so both paths can never read a buoy differently:
 * only quality code 1, -9999 is no value, air fields above the surface, water from the shallowest sensor
 * down to 2 m, every field within 20 minutes of the row time, and a wind without its gust is no wind.
 * One difference, on purpose: speed, gust and direction are taken from the SAME 10-minute instant (the
 * latest one with a valid speed and gust), because here each one is its own series.
 */
import type { BuoyReadingRow } from './db.js';
import type { PlatformRequest, PlatformRow } from './intecmarLogic.js';
import { platformPlan } from './intecmarLogic.js';
import { OBS_MAX_FIELD_SKEW_MS, OBS_SURFACE_MAX_DEPTH_M, OBS_VALID_CODE } from '../src/api/obsCosteiroParse.js';

/**
 * INTECMAR station code → the station_id the same buoy has in buoy_readings, as buoyFetcher's
 * OBS_STATIONS maps it (a test checks they agree). Names as stored there.
 */
export const INTECMAR_PLATFORMS: ReadonlyArray<{ code: number; canonicalId: number; name: string }> = [
  { code: 15001, canonicalId: 1250, name: 'Cortegada (Arousa)' },
  { code: 15004, canonicalId: 1253, name: 'A Guarda' },
  { code: 15005, canonicalId: 1255, name: 'Ribeira' },
  { code: 15100, canonicalId: 1251, name: 'Rande (Ría Vigo)' },
  { code: 15009, canonicalId: 15009, name: 'Muros' },
];

/** Parameter ids (the platforms' own catalogue, 19-oct). */
export const P = {
  windSpeed: 81,     // VV: AVG and RACHA (gust)
  windDir: 82,       // DV
  airTemp: 83,       // TA
  humidity: 86,      // HR
  dewPoint: 10018,   // TO (derived by INTECMAR from TA and HR; theirs is kept, ours would differ by up to 0.2 C)
  waterTemp: 20003,  // TAU
  salinity: 20005,   // SAL
  current: 20000,    // VC: archived at night, not read by the map
} as const;

/**
 * What the live pass asks: the night's plan without the current (nothing in the map reads it).
 * 8 series per platform with an anemometer, 5 for Rande: 37 requests per pass.
 */
export function livePlan(): PlatformRequest[] {
  return platformPlan().filter((p) => p.parameterId !== P.current);
}

const DAY_MS = 86_400_000;
const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The window of a live pass: today (UTC) and, before 01:00 UTC, yesterday too, so the last samples of
 * the day before (Rande publishes ~30 min late) still reach the table. `end_date` stops at 00:00 of the
 * day it names, so the window ends tomorrow.
 */
export function liveWindow(nowMs: number): { begin: string; end: string } {
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const beforeOne = nowMs - today < 3_600_000;
  return { begin: utcDate(beforeOne ? today - DAY_MS : today), end: utcDate(today + DAY_MS) };
}

// ── Environment ─────────────────────────────────────────

/** Every 30 min: INTECMAR answered in writing on 29-oct that «cada 30 minutos está perfecto» (on 21-oct they had
 *  said hourly was enough, and we asked about 20-30). Below 10 minutes there is nothing new to read. */
export const LIVE_DEFAULT_MS = 30 * 60_000;
export const LIVE_MIN_MS = 10 * 60_000;
/** 48 live passes of 37 requests (~1,800) plus the night stay under it, with room for the retries of a bad
 *  day; still under a third of the ~10,000 a day at which INTECMAR blocks the account. */
export const DAILY_CAP_DEFAULT = 3000;

/** INTECMAR_LIVE: '0', 'off', 'false' or 'no' switch the live feed off; anything else (or unset) leaves it on. */
export function liveEnabled(raw: string | undefined): boolean {
  return !['0', 'off', 'false', 'no'].includes((raw ?? '').trim().toLowerCase());
}

/** INTECMAR_LIVE_MS in milliseconds; unreadable → 30 min; never below 10 min. */
export function liveIntervalMs(raw: string | undefined): number {
  const n = Number(raw);
  if (raw == null || raw.trim() === '' || !Number.isFinite(n) || n <= 0) return LIVE_DEFAULT_MS;
  return Math.max(LIVE_MIN_MS, Math.round(n));
}

/** INTECMAR_MAX_REQUESTS_PER_DAY; unreadable → 3000. INTECMAR blocks the account near 10,000 a day. */
export function dailyCap(raw: string | undefined): number {
  const n = Number(raw);
  if (raw == null || raw.trim() === '' || !Number.isFinite(n) || n <= 0) return DAILY_CAP_DEFAULT;
  return Math.floor(n);
}

// ── Requests per UTC day ────────────────────────────────

export interface DayCount {
  day: string;                       // UTC YYYY-MM-DD
  total: number;
  byTag: Record<string, number>;     // 'vivo', 'noche'
}

export interface RequestLedger {
  current: DayCount;
  previous: DayCount | null;
}

export function emptyLedger(nowMs: number): RequestLedger {
  return { current: { day: utcDate(nowMs), total: 0, byTag: {} }, previous: null };
}

/** The ledger as of `nowMs`: a new UTC day moves today's count to `previous`. */
export function rollLedger(l: RequestLedger, nowMs: number): RequestLedger {
  const day = utcDate(nowMs);
  if (l.current.day === day) return l;
  return { current: { day, total: 0, byTag: {} }, previous: l.current };
}

export function addRequest(l: RequestLedger, nowMs: number, tag: string): RequestLedger {
  const r = rollLedger(l, nowMs);
  return {
    previous: r.previous,
    current: { day: r.current.day, total: r.current.total + 1, byTag: { ...r.current.byTag, [tag]: (r.current.byTag[tag] ?? 0) + 1 } },
  };
}

export function requestsLeft(l: RequestLedger, nowMs: number, cap: number): number {
  return Math.max(0, cap - rollLedger(l, nowMs).current.total);
}

export function describeDay(d: DayCount): string {
  const tags = Object.entries(d.byTag).sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => `${t} ${n}`).join(', ');
  return `${d.day}: ${d.total}${tags ? ` (${tags})` : ''}`;
}

// ── Breaker: errors in a row stop the source ────────────

/** This many failed requests in a row (429, 5xx, timeouts, network) open the breaker... */
export const BREAKER_FAILS = 5;
/** ...for this long; both live and night are refused meanwhile. */
export const BREAKER_OPEN_MS = 60 * 60_000;

export interface BreakerState {
  fails: number;
  openUntil: number;
}

export const closedBreaker = (): BreakerState => ({ fails: 0, openUntil: 0 });

export function breakerOpen(s: BreakerState, nowMs: number): boolean {
  return nowMs < s.openUntil;
}

/** After an answer: a success closes it; the BREAKER_FAILS-th failure in a row opens it (and restarts the count). */
export function breakerNote(s: BreakerState, ok: boolean, nowMs: number): BreakerState {
  if (ok) return closedBreaker();
  const fails = s.fails + 1;
  return fails >= BREAKER_FAILS ? { fails: 0, openUntil: nowMs + BREAKER_OPEN_MS } : { fails, openUntil: s.openUntil };
}

// ── Series that come back empty ─────────────────────────

/** A live series that came back with no sample at all (a stopped sensor, Cíes-like) is asked again after this. */
export const EMPTY_SKIP_LIVE_MS = 6 * 60 * 60_000;
/** The same at night: one probe a week. */
export const EMPTY_SKIP_NIGHT_MS = 7 * 86_400_000;

export const seriesKey = (r: { station: number; parameterId: number; func: string }) => `${r.station}|${r.parameterId}|${r.func}`;

/** Whether a series is due (not resting after an empty answer). */
export function seriesDue(skip: ReadonlyMap<string, number>, key: string, nowMs: number): boolean {
  return (skip.get(key) ?? 0) <= nowMs;
}

/** Records an answer: an empty one rests the series for `restMs`, anything else clears it. */
export function noteSeriesAnswer(skip: Map<string, number>, key: string, samples: number, nowMs: number, restMs: number): void {
  if (samples === 0) skip.set(key, nowMs + restMs);
  else skip.delete(key);
}

// ── The reading ─────────────────────────────────────────

export interface LiveReading {
  time: string;                      // ISO UTC, the newest 10-minute instant the row carries
  windSpeed: number | null;
  windDir: number | null;
  windGust: number | null;
  waterTemp: number | null;
  airTemp: number | null;
  salinity: number | null;
  humidity: number | null;
  dewPoint: number | null;
}

type Valid = { ms: number; value: number; depth: number };

function validSamples(rows: PlatformRow[], parameterId: number, func: string, layer: 'air' | 'surface'): Valid[] {
  const out: Valid[] = [];
  for (const r of rows) {
    if (r.parameterId !== parameterId || r.func !== func) continue;
    if (r.value == null || r.qualityCode !== OBS_VALID_CODE) continue;
    const ms = r.time.getTime();
    if (!Number.isFinite(ms)) continue;
    const onLayer = layer === 'air' ? r.depthM < 0 : r.depthM >= 0 && r.depthM <= OBS_SURFACE_MAX_DEPTH_M;
    if (onLayer) out.push({ ms, value: r.value, depth: r.depthM });
  }
  return out;
}

/** The latest valid sample not after the row time and within the skew of it; for water, the shallowest. */
function pick(samples: Valid[], rowMs: number): Valid | null {
  let best: Valid | null = null;
  for (const s of samples) {
    if (s.ms > rowMs || rowMs - s.ms > OBS_MAX_FIELD_SKEW_MS) continue;
    if (!best || s.depth < best.depth || (s.depth === best.depth && s.ms > best.ms)) best = s;
  }
  return best;
}

/**
 * The current reading of one platform out of the rows its live requests returned, or null when nothing
 * valid is there or the newest valid instant is older than `maxAgeMs` (the same 6 h gate as the
 * MeteoGalicia path).
 */
export function liveReading(rows: PlatformRow[], station: number, nowMs: number, maxAgeMs: number): LiveReading | null {
  const mine = rows.filter((r) => r.station === station);
  const speed = validSamples(mine, P.windSpeed, 'AVG', 'air');
  const gust = validSamples(mine, P.windSpeed, 'RACHA', 'air');
  const dir = validSamples(mine, P.windDir, 'AVG', 'air');
  const air = validSamples(mine, P.airTemp, 'AVG', 'air');
  const hum = validSamples(mine, P.humidity, 'AVG', 'air');
  const dew = validSamples(mine, P.dewPoint, 'AVG', 'air');
  const water = validSamples(mine, P.waterTemp, 'AVG', 'surface');
  const sal = validSamples(mine, P.salinity, 'AVG', 'surface');

  let rowMs = -Infinity;
  for (const list of [speed, gust, dir, air, hum, dew, water, sal]) {
    for (const s of list) if (s.ms <= nowMs + 60_000 && s.ms > rowMs) rowMs = s.ms;
  }
  if (!Number.isFinite(rowMs) || nowMs - rowMs > maxAgeMs) return null;

  // Wind: the latest instant with both a valid speed and a valid gust, and the direction of that instant.
  const gustAt = new Map(gust.map((g) => [g.ms, g.value]));
  let windMs = -Infinity;
  let windSpeed: number | null = null;
  for (const s of speed) {
    if (s.ms > rowMs || rowMs - s.ms > OBS_MAX_FIELD_SKEW_MS || !gustAt.has(s.ms) || s.ms <= windMs) continue;
    windMs = s.ms;
    windSpeed = s.value;
  }
  const windGust = windSpeed == null ? null : gustAt.get(windMs) ?? null;
  const windDir = windSpeed == null ? null : dir.find((d) => d.ms === windMs)?.value ?? null;

  const reading: LiveReading = {
    time: new Date(rowMs).toISOString().replace('.000Z', 'Z'),
    windSpeed,
    windDir,
    windGust,
    waterTemp: pick(water, rowMs)?.value ?? null,
    airTemp: pick(air, rowMs)?.value ?? null,
    salinity: pick(sal, rowMs)?.value ?? null,
    humidity: pick(hum, rowMs)?.value ?? null,
    dewPoint: pick(dew, rowMs)?.value ?? null,
  };
  const { time: _t, ...fields } = reading;
  return Object.values(fields).some((v) => v !== null) ? reading : null;
}

/** The buoy_readings row of one platform, with the shape of the MeteoGalicia path and source 'intecmar'. */
export function liveBuoyRow(
  platform: { canonicalId: number; name: string },
  r: LiveReading,
): BuoyReadingRow {
  return {
    time: r.time,
    stationId: platform.canonicalId,
    stationName: platform.name,
    source: 'intecmar',
    waveHeight: null, waveHeightMax: null, wavePeriod: null, wavePeriodMean: null, waveDir: null,
    windSpeed: r.windSpeed,
    windDir: r.windDir,
    windGust: r.windGust,
    waterTemp: r.waterTemp,
    airTemp: r.airTemp,
    airPressure: null,
    currentSpeed: null, currentDir: null,
    salinity: r.salinity,
    seaLevel: null,
    humidity: r.humidity,
    dewPoint: r.dewPoint,
  };
}

// ── The log line ────────────────────────────────────────

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
}

/**
 * One fragment per platform for the pass's log line: INTECMAR's newest instant and its delay, and,
 * for the audit, the newest instant MeteoGalicia's path has stored for the same buoy.
 * «Cortegada 10:50 (+12 min; MG 10:20)», «Rande sin dato (MG 10:30)».
 */
export function describePlatform(name: string, intecmarMs: number | null, mgMs: number | null, nowMs: number): string {
  const short = name.replace(/ \(.*\)$/, '');
  const mg = mgMs == null ? 'MG sin dato' : `MG ${hhmm(mgMs)}`;
  if (intecmarMs == null) return `${short} sin dato (${mg})`;
  return `${short} ${hhmm(intecmarMs)} (+${Math.round((nowMs - intecmarMs) / 60_000)} min; ${mg})`;
}
