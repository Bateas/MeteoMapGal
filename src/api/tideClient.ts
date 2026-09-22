/**
 * Tide data client — IHM (Instituto Hidrográfico de la Marina)
 *
 * Free, no-auth JSON API for official Spanish tide predictions.
 * Covers all major Rías Baixas ports: Vigo, Marín, Vilagarcía, Baiona, etc.
 *
 * API: https://ideihm.covam.es/api-ihm/getmarea
 */

export interface TidePoint {
  /** HH:MM in local Spanish time (Europe/Madrid) */
  time: string;
  /** Meters above chart datum */
  height: number;
  /** 'pleamar' (high) or 'bajamar' (low) */
  type: 'high' | 'low';
  /** Local date string YYYY-MM-DD */
  date?: string;
  /** Timestamp in ms (UTC) */
  epochMs?: number;
  /** Original raw UTC time HH:MM from IHM */
  rawUtc?: string;
  /** Who published the table. Absent means the IHM. */
  source?: 'ihm' | 'meteosix';
}

export interface TideStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface TideData {
  station: TideStation;
  date: string;
  points: TidePoint[];
  fetchedAt: Date;
}

// ── Rías Baixas tide stations (IHM IDs) ──────────────────
// Cover all 3 Rías: Vigo, Pontevedra, Arousa (sector center -8.68, 42.30, r=40km)

export const RIAS_TIDE_STATIONS: TideStation[] = [
  { id: '29', name: 'Vigo',       lat: 42.240, lon: -8.730 },
  { id: '28', name: 'Marín',      lat: 42.410, lon: -8.690 },
  { id: '26', name: 'Vilagarcía', lat: 42.600, lon: -8.770 },
  { id: '30', name: 'Baiona',     lat: 42.118, lon: -8.845 },
  { id: '27', name: 'Sanxenxo',   lat: 42.397, lon: -8.805 },
];

// Default station (closest to sector center)
export const DEFAULT_TIDE_STATION = RIAS_TIDE_STATIONS[0]; // Vigo

import { fetchWithRetry } from './fetchWithRetry';
import { METEOSIX } from '../config/apiEndpoints';

const IHM_BASE = '/ihm-api';

/** Format a Date object to local HH:MM in Europe/Madrid timezone */
export function formatToLocalHHMM(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const h = parts.find((p) => p.type === 'hour')?.value ?? String(date.getHours()).padStart(2, '0');
    const m = parts.find((p) => p.type === 'minute')?.value ?? String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  } catch {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
}

/** Format a Date object to local YYYY-MM-DD in Europe/Madrid timezone */
export function formatToLocalDate(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const mo = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && mo && d) return `${y}-${mo}-${d}`;
  } catch {
    // fallback
  }
  return date.toISOString().slice(0, 10);
}

// ── Once per page load ──────────────────────────────────────────────
//
// Six surfaces read the tide table (ticker, panel, spot popups, regatta,
// gauge comparison), each for up to three days, each on its own timer. With
// the IHM down every one of them used to retry on its own, and a single
// open page sent the same three failing requests every few seconds. A day's
// table is astronomical and never changes, so one answer per station and day
// is kept for the whole page load, a failure included, and each publisher is
// probed once: after an outage it is not asked again until the next reload.

/** A request the publisher answered with a 4xx: our request, not its outage. */
class TideHttpError extends Error {
  readonly status: number;
  constructor(publisher: string, status: number) {
    super(`${publisher} error: ${status}`);
    this.status = status;
  }
}

/** Thrown instead of asking a publisher already found down this page load. */
class TideUnavailableError extends Error {}

/** The service answered, but with an error envelope instead of a table. */
class TideAnswerError extends Error {}

/**
 * A 4xx or an error envelope is about one request: the service answered.
 * Everything else (5xx, 429, network, timeout, non-JSON) is the service.
 */
function isOutage(err: unknown): boolean {
  if (err instanceof TideAnswerError) return false;
  if (!(err instanceof TideHttpError)) return true;
  return err.status >= 500 || err.status === 429;
}

function sessionGate(name: string) {
  let state: 'unknown' | 'up' | 'down' = 'unknown';
  let probe: Promise<void> | null = null;
  return {
    get down() { return state === 'down'; },
    async run<T>(fn: () => Promise<T>): Promise<T> {
      // Until the publisher has answered once, one request at a time: when it
      // is down, only the first caller pays for finding out.
      while (state === 'unknown' && probe) await probe;
      if (state === 'down') throw new TideUnavailableError(`${name} unavailable until reload`);
      const attempt = (async () => {
        try {
          const value = await fn();
          state = 'up';
          return value;
        } catch (err) {
          if (isOutage(err)) state = 'down';
          throw err;
        }
      })();
      if (state === 'unknown') {
        const settled = attempt.then(() => undefined, () => undefined);
        probe = settled;
        void settled.then(() => { if (probe === settled) probe = null; });
      }
      return attempt;
    },
    reset() { state = 'unknown'; probe = null; },
  };
}

const ihmGate = sessionGate('IHM');
const meteoSixGate = sessionGate('MeteoSIX');

/** Every station-day asked for this page load, answered or failed. */
const sessionTables = new Map<string, Promise<TidePoint[]>>();

/**
 * Fetch tide predictions for a station and date.
 * Converts IHM UTC predictions to local Spanish time (CEST/CET) with absolute timestamps.
 * Returns high/low tide points with times and heights.
 */
export function fetchTidePredictions(
  stationId: string = DEFAULT_TIDE_STATION.id,
  date?: Date
): Promise<TidePoint[]> {
  const day = date ?? new Date();
  const key = tideCacheKey(stationId, day);
  let table = sessionTables.get(key);
  if (!table) {
    table = resolveTideDay(stationId, day, key);
    sessionTables.set(key, table);
  }
  return table;
}

async function resolveTideDay(stationId: string, day: Date, key: string): Promise<TidePoint[]> {
  let ihmError: unknown;
  try {
    const points = await ihmGate.run(() => fetchTidePredictionsLive(stationId, day));
    if (points.length > 0) writeTideCache(key, points);
    servedFromCache.delete(key);
    servedFromMeteoSix.delete(key);
    return points;
  } catch (err) {
    ihmError = err;
  }
  // A day's tide table is astronomical and never changes, so the last good
  // copy of it is not stale data: it is the same answer. Serving it keeps
  // every tide surface alive through an IHM outage instead of all of them
  // failing at once.
  const cached = readTideCache(key);
  if (cached) {
    servedFromCache.add(key);
    return cached;
  }
  // No stored copy: the day has never loaded here. MeteoGalicia publishes
  // its own tide table for the Galician ports, so ask it for the same day.
  // It only serves today onwards, so a past day is not worth a request.
  const station = RIAS_TIDE_STATIONS.find((s) => s.id === stationId);
  if (station && formatToLocalDate(day) >= formatToLocalDate(new Date())) {
    try {
      const fallback = await fetchMeteoSixTideDay(station, day);
      if (fallback.points.length > 0) {
        servedFromMeteoSix.set(key, fallback.portName);
        return fallback.points;
      }
    } catch {
      // Both publishers down: report the original IHM failure.
    }
  }
  throw ihmError;
}

// ── MeteoGalicia fallback ─────────────────────────────────────────

/** Port whose table MeteoSIX returned, keyed like the cache. */
const servedFromMeteoSix = new Map<string, string | null>();

/** "2026-09-22T04:32:00+02" → "+02:00": JS needs the colon in the offset. */
function fixMeteoSixOffset(ts: string): string {
  return ts.replace(/([+-]\d{2})$/, '$1:00').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
}

/**
 * Parse a MeteoSIX /getTidesInfo answer into the extremes of one local day.
 * MeteoSIX picks the Galician port nearest to the coordinates and says which
 * one, so the name is returned for the label rather than assumed.
 */
export function parseMeteoSixTides(data: unknown, day: Date): { points: TidePoint[]; portName: string | null } {
  const features = (data as { features?: unknown[] } | null)?.features;
  const props = (Array.isArray(features) ? features[0] : null) as
    | { properties?: { port?: { name?: string }; days?: unknown[] } }
    | null;
  const properties = props?.properties;
  const portName = properties?.port?.name ?? null;
  const wanted = formatToLocalDate(day);
  const points: TidePoint[] = [];

  for (const dayEntry of properties?.days ?? []) {
    const variables = (dayEntry as { variables?: unknown[] }).variables ?? [];
    for (const v of variables) {
      const variable = v as { name?: string; summary?: unknown[] };
      if (variable.name !== 'tides') continue;
      for (const s of variable.summary ?? []) {
        const e = s as { state?: string; timeInstant?: string; height?: number | string };
        if (!e.timeInstant || e.height == null) continue;
        const height = typeof e.height === 'number' ? e.height : parseFloat(e.height);
        const when = new Date(fixMeteoSixOffset(e.timeInstant));
        if (!Number.isFinite(height) || Number.isNaN(when.getTime())) continue;
        const date = formatToLocalDate(when);
        if (date !== wanted) continue;
        points.push({
          time: formatToLocalHHMM(when),
          height,
          type: /high/i.test(e.state ?? '') ? 'high' : 'low',
          date,
          epochMs: when.getTime(),
          source: 'meteosix',
        });
      }
    }
  }

  points.sort((a, b) => (a.epochMs ?? 0) - (b.epochMs ?? 0));
  return { points, portName };
}

/** Wait before the one retry of an answer that came back as an error envelope. */
const METEOSIX_ENVELOPE_RETRY_MS = 2_000;

/** MeteoSIX's own error answer: HTTP 200 with `{"exception": {...}}`. */
function meteoSixFailure(body: unknown): string | null {
  const exception = (body as { exception?: { message?: string } } | null)?.exception;
  return exception ? (exception.message ?? 'exception') : null;
}

/**
 * The whole MeteoSIX answer for one port. Asked with no time range, it
 * returns today and the next four days, which are all the days the app ever
 * asks it for, so one request per port serves the page load. An explicit
 * one-day range for tomorrow was seen to fail while the open one answered.
 * MeteoSIX also answers 200 with an error envelope from time to time and the
 * same request works a moment later: that gets exactly one more try.
 */
async function fetchMeteoSixTable(station: TideStation): Promise<unknown> {
  const url = METEOSIX.tides(station.lon, station.lat);
  for (let attempt = 0; ; attempt++) {
    const response = await fetchWithRetry(url, { label: 'Tide MeteoSIX', timeout: 10_000, maxRetries: 1 });
    if (!response.ok) throw new TideHttpError('MeteoSIX tides', response.status);
    const body: unknown = await response.json();
    const failure = meteoSixFailure(body);
    if (!failure) return body;
    if (attempt >= 1) throw new TideAnswerError(`MeteoSIX tides: ${failure}`);
    await new Promise((resolve) => setTimeout(resolve, METEOSIX_ENVELOPE_RETRY_MS));
  }
}

/**
 * One MeteoSIX answer per port and Madrid day, failed or not. Per day and not
 * per page load: the answer covers five days from the day it was asked, so a
 * tab left open longer through an IHM outage would otherwise lose its stand-in
 * table without asking again. Still at most one request per port per day.
 */
const meteoSixTables = new Map<string, Promise<unknown>>();

async function fetchMeteoSixTideDay(
  station: TideStation,
  day: Date,
): Promise<{ points: TidePoint[]; portName: string | null }> {
  const key = `${station.id}:${yyyymmdd(new Date())}`;
  let table = meteoSixTables.get(key);
  if (!table) {
    table = meteoSixGate.run(() => fetchMeteoSixTable(station));
    meteoSixTables.set(key, table);
  }
  return parseMeteoSixTides(await table, day);
}

/** The MeteoGalicia port whose table stood in for that day, if one did. */
export function meteoSixTidePort(stationId: string, day: Date): string | null | undefined {
  const key = tideCacheKey(stationId, day);
  return servedFromMeteoSix.has(key) ? servedFromMeteoSix.get(key) : undefined;
}

// ── Last-good tide tables ──────────────────────────────────────────

const TIDE_CACHE_PREFIX = 'ihm-tide:v1:';
/** Tables older than this many days are pruned on write. */
const TIDE_CACHE_KEEP_DAYS = 3;
/** Keys whose last answer came from the cache rather than the IHM. */
const servedFromCache = new Set<string>();

/**
 * The Madrid calendar day as YYYYMMDD. The tides are Galician, so the cache
 * key, the IHM request and the MeteoSIX day filter all name the day THERE.
 * With the browser's own date, a visitor in Portugal loading the page between
 * 23:00 and midnight keyed Madrid's tomorrow as today and was shown
 * tomorrow's tides as today's.
 */
function yyyymmdd(d: Date): string {
  return formatToLocalDate(d).replace(/-/g, '');
}

function tideCacheKey(stationId: string, day: Date): string {
  return `${TIDE_CACHE_PREFIX}${stationId}:${yyyymmdd(day)}`;
}

function readTideCache(key: string): TidePoint[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as TidePoint[]) : null;
  } catch {
    return null;
  }
}

function writeTideCache(key: string, points: TidePoint[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(points));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - TIDE_CACHE_KEEP_DAYS);
    const oldest = yyyymmdd(cutoff);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(TIDE_CACHE_PREFIX)) continue;
      const stamp = k.slice(k.lastIndexOf(':') + 1);
      if (stamp < oldest) localStorage.removeItem(k);
    }
  } catch {
    // Private mode, quota, or no storage at all: the table simply is not kept.
  }
}

/** True when the last answer for that station and day came from the cache. */
export function isTideFromCache(stationId: string, day: Date): boolean {
  return servedFromCache.has(tideCacheKey(stationId, day));
}

/** Test-only: what a page reload does — forget every answer and every outage. */
export function __clearTideTableCacheForTests(): void {
  servedFromCache.clear();
  servedFromMeteoSix.clear();
  sessionTables.clear();
  meteoSixTables.clear();
  ihmGate.reset();
  meteoSixGate.reset();
}

async function fetchTidePredictionsLive(
  stationId: string,
  date: Date,
): Promise<TidePoint[]> {
  const params = new URLSearchParams({
    request: 'gettide',
    id: stationId,
    format: 'json',
  });

  // The same Madrid day the cache key names (see yyyymmdd).
  const madridDay = formatToLocalDate(date);
  params.set('date', yyyymmdd(date));

  const url = `${IHM_BASE}/api-ihm/getmarea?${params}`;

  // Two retries with backoff (2 s, then 4 s) only while the IHM is being
  // probed; after that the session gate decides, not the retry loop.
  const response = await fetchWithRetry(url, {
    label: 'Tide',
    timeout: 10_000,
    maxRetries: 2,
  });

  if (!response.ok) {
    throw new TideHttpError('IHM API', response.status);
  }

  const data = await response.json();

  // Parse IHM response format
  const mareas = data?.mareas;
  if (!mareas?.datos?.marea) {
    return [];
  }

  const baseFecha = mareas.fecha || madridDay;

  const points: TidePoint[] = [];
  const rawList = Array.isArray(mareas.datos.marea)
    ? mareas.datos.marea
    : [mareas.datos.marea];

  for (const m of rawList) {
    if (!m.hora || m.altura == null) continue;

    let localTime = m.hora;
    let epochMs: number | undefined;
    let localDateStr: string | undefined;

    const [hh, min] = m.hora.split(':').map(Number);
    const [y, mo, d] = baseFecha.split('-').map(Number);

    if (
      Number.isFinite(hh) &&
      Number.isFinite(min) &&
      Number.isFinite(y) &&
      Number.isFinite(mo) &&
      Number.isFinite(d)
    ) {
      // IHM reports times strictly in UTC (huso 0).
      // Construct UTC date and convert to Spanish local time (CEST in summer / CET in winter).
      const utcDate = new Date(Date.UTC(y, mo - 1, d, hh, min, 0));
      epochMs = utcDate.getTime();
      localTime = formatToLocalHHMM(utcDate);
      localDateStr = formatToLocalDate(utcDate);
    }

    points.push({
      time: localTime,
      height: parseFloat(m.altura),
      type: m.tipo === 'pleamar' ? 'high' : 'low',
      date: localDateStr,
      epochMs,
      rawUtc: m.hora,
    });
  }

  return points;
}

export interface FetchTidesResult {
  today: TidePoint[];
  tomorrow: TidePoint[];
  yesterday?: TidePoint[];
  all?: TidePoint[];
  /** True when today's or tomorrow's table came from the last-good cache. */
  fromCache?: boolean;
  /** Set when MeteoGalicia's table stood in for the IHM: the port it used. */
  meteoSixPort?: string | null;
}

/**
 * Fetch today + tomorrow tides for a station.
 * Returns combined data for a 48h view partitioned by local calendar days.
 */
export async function fetchTides48h(
  stationId: string = DEFAULT_TIDE_STATION.id
): Promise<FetchTidesResult> {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [yesterdayPts, todayPts, tomorrowPts] = await Promise.all([
    fetchTidePredictions(stationId, yesterday).catch(() => []),
    fetchTidePredictions(stationId, now),
    // Only today decides: a missing tomorrow must not hide today's table,
    // and with failures kept for the page load it would hide it until reload.
    fetchTidePredictions(stationId, tomorrow).catch(() => []),
  ]);

  const all = [...yesterdayPts, ...todayPts, ...tomorrowPts];
  const seen = new Set<string>();
  const uniquePoints: TidePoint[] = [];

  for (const p of all) {
    const key = p.epochMs ? String(p.epochMs) : `${p.date || ''}_${p.time}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePoints.push(p);
    }
  }
  uniquePoints.sort((a, b) => (a.epochMs || 0) - (b.epochMs || 0));

  const yesterdayStr = formatToLocalDate(yesterday);
  const todayStr = formatToLocalDate(now);
  const tomorrowStr = formatToLocalDate(tomorrow);

  const yesterdayList = uniquePoints.filter((p) => p.date === yesterdayStr);
  const today = uniquePoints.filter((p) => p.date === todayStr);
  const tomorrowList = uniquePoints.filter((p) => p.date === tomorrowStr);

  return {
    yesterday: yesterdayList.length > 0 ? yesterdayList : yesterdayPts,
    today: today.length > 0 ? today : todayPts,
    tomorrow: tomorrowList.length > 0 ? tomorrowList : tomorrowPts,
    all: uniquePoints,
    fromCache: isTideFromCache(stationId, now) || isTideFromCache(stationId, tomorrow),
    meteoSixPort: meteoSixTidePort(stationId, now) ?? meteoSixTidePort(stationId, tomorrow),
  };
}
