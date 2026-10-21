/**
 * The pure half of the INTECMAR archive (intecmarArchive.ts): what to ask the Observatorio
 * Costeiro's API (api.intecmar.gal) each night and how its answers become rows.
 *
 * Why the archive: the live buoy feed (MeteoGalicia's platform API, buoyFetcher.ts) only serves the
 * latest instant, and on 19-oct-2026 it was measured losing 35-45 % of Cortegada's 10-minute readings
 * (the other four buoys complete). INTECMAR, who owns the platforms, serves every 10-minute value with
 * its quality code a day later. Kept as published, with every code (never filtered before storing):
 * it fills those holes and is the clean history for calibration and ML.
 *
 * One parameter per request (the API has no «all parameters of a platform» call), so the plan below
 * is the short list the app uses: 39 requests a night. Codes and functions from each platform's own
 * catalogue (/moorings/station/{code}/parameter, 19-oct): Rande has no anemometer; only Cortegada
 * and Ribeira measure current.
 */

export interface PlatformRequest {
  station: number;
  parameterId: number;
  func: string;
}

const WIND_AND_AIR: Array<[number, string]> = [[81, 'AVG'], [81, 'RACHA'], [82, 'AVG'], [83, 'AVG'], [86, 'AVG'], [10018, 'AVG']];
const WATER: Array<[number, string]> = [[20003, 'AVG'], [20005, 'AVG']];
const CURRENT: Array<[number, string]> = [[20000, 'AVG']];

/** 15001 Cortegada, 15004 A Guarda, 15005 Ribeira, 15009 Muros, 15100 Rande (15002 Cíes: no data since 4-dec-2025). */
const PLAN: Record<number, Array<[number, string]>> = {
  15001: [...WIND_AND_AIR, ...WATER, ...CURRENT],
  15004: [...WIND_AND_AIR, ...WATER],
  15005: [...WIND_AND_AIR, ...WATER, ...CURRENT],
  15009: [...WIND_AND_AIR, ...WATER],
  15100: [[83, 'AVG'], [86, 'AVG'], [10018, 'AVG'], ...WATER],
};

export function platformPlan(): PlatformRequest[] {
  return Object.entries(PLAN).flatMap(([station, list]) =>
    list.map(([parameterId, func]) => ({ station: Number(station), parameterId, func })));
}

const DAY_MS = 86_400_000;

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The two whole UTC days before `nowMs`, as the API wants them. Its `end_date` stops at 00:00 of the
 * day it names (2026-09-20 to 2026-09-20 returns one sample; two days return 2 x 144 + 1), so the
 * window ends on today. Two days, not one: a night that failed is covered by the next.
 */
export function platformWindow(nowMs: number): { begin: string; end: string } {
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  return { begin: utcDate(today - 2 * DAY_MS), end: utcDate(today) };
}

/** What the table holds of one series on one past UTC day (intecmarArchive's coverage query). */
export interface DayCoverage {
  dayMs: number;        // 00:00 UTC of the day
  samples: number;      // distinct 10-minute instants stored (any depth, any quality code)
  lastMs: number;       // newest instant stored that day
  fetchedMs: number;    // newest fetched_at of that day's rows
}

/** A whole 10-minute day: 00:00 to 23:50. */
export const FULL_DAY_SAMPLES = 144;
/**
 * A day fetched this long after it ended is final: INTECMAR publishes within ~10 min (Rande ~30) and
 * its values do not change once in their base (21-oct). Whatever it lacks, INTECMAR lacks too.
 */
export const FINAL_AFTER_MS = 45 * 60_000;
/**
 * The night never looks further back than this, so a stopped platform (Cíes-like) can never make the
 * range grow without limit (and 10-minute ranges over 3 months fail at the API). Older holes are for the
 * monthly history download agreed with INTECMAR, not for the night.
 */
export const NIGHT_LOOKBACK_DAYS = 7;
export const NIGHT_OVERLAP_MS = 60 * 60_000;

/**
 * Incremental night range of one series: from the first past day that is not complete (with at least
 * one hour of overlap over what was stored before it) to today, or null when every stored day is
 * complete. The live pass (intecmarLive.ts) writes today and yesterday as whole days, so on a normal
 * night the series it reads cost nothing; a night or a live feed that failed is recovered from its own
 * gap, up to NIGHT_LOOKBACK_DAYS (7) back. A series with nothing stored in the lookback gets the old two-day
 * window: INTECMAR asked to be told before any bigger download.
 *
 * Days before the first stored one are not judged: the lookback query cannot tell «never archived»
 * from «lost».
 */
export function nightRange(coverage: DayCoverage[], nowMs: number): { begin: string; end: string } | null {
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const past = coverage.filter((d) => d.dayMs < today && d.dayMs >= today - NIGHT_LOOKBACK_DAYS * DAY_MS);
  if (past.length === 0) return platformWindow(nowMs);
  const byDay = new Map(past.map((d) => [d.dayMs, d]));
  const first = Math.min(...past.map((d) => d.dayMs));
  for (let day = first; day < today; day += DAY_MS) {
    const d = byDay.get(day);
    const complete = d != null && (d.samples >= FULL_DAY_SAMPLES || d.fetchedMs >= day + DAY_MS + FINAL_AFTER_MS);
    if (complete) continue;
    const before = past.filter((x) => x.dayMs < day).map((x) => x.lastMs);
    const from = before.length > 0 ? Math.min(day, Math.max(...before) - NIGHT_OVERLAP_MS) : day;
    return { begin: utcDate(from), end: utcDate(today) };
  }
  return null;
}

/**
 * The CTD casts are published on Thursdays (INTECMAR, 21-oct): the list is asked on Fridays, and on any
 * other night only when something is owed (a pass that failed or left station-days for later, a
 * restart that does not know, or platform days being recovered beyond the usual two, which means
 * nights were missed). A normal night asks yesterday plus the day before for its hour of overlap: 2.
 */
export function shouldListCasts(nowMs: number, owed: boolean, recoveringDays: number): boolean {
  return new Date(nowMs).getUTCDay() === 5 || owed || recoveringDays > 2;
}

/** Whole days between the earliest `begin` of a set of ranges and `end` (the night's recovery depth). */
export function recoveryDays(ranges: Array<{ begin: string; end: string }>): number {
  if (ranges.length === 0) return 0;
  const earliest = Math.min(...ranges.map((r) => Date.parse(`${r.begin}T00:00:00Z`)));
  const end = Math.max(...ranges.map((r) => Date.parse(`${r.end}T00:00:00Z`)));
  return Math.round((end - earliest) / DAY_MS);
}

/** Day after a YYYY-MM-DD date, for one-day ranges. */
export function nextDay(date: string): string {
  return utcDate(Date.parse(`${date}T00:00:00Z`) + DAY_MS);
}

export interface PlatformRow {
  time: Date;
  station: number;
  parameterId: number;
  parameterCode: string;
  func: string;
  depthM: number;
  value: number | null;
  qualityCode: number | null;
}

const MISSING = -9999;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * /moorings/data/... answers with one series per depth: metadata (StationCode, ParameterId,
 * ParameterCode, Function, Depth) and `Samples` of {Date (UTC, with Z), Value, QualityCode}.
 * -9999 is the API's «no value» (it comes with code 9): stored as NULL with its code. A sample
 * without a readable date is the only thing dropped.
 */
export function platformRows(payload: unknown): PlatformRow[] {
  if (!Array.isArray(payload)) return [];
  const rows: PlatformRow[] = [];
  for (const s of payload as Array<Record<string, unknown>>) {
    const station = num(s.StationCode) ?? num(Number(s.StationCode));
    const parameterId = num(s.ParameterId) ?? num(Number(s.ParameterId));
    const depthM = num(s.Depth);
    if (station == null || parameterId == null || depthM == null || !Array.isArray(s.Samples)) continue;
    const parameterCode = String(s.ParameterCode ?? '');
    const func = String(s.Function ?? '');
    for (const x of s.Samples as Array<Record<string, unknown>>) {
      const t = typeof x.Date === 'string' ? Date.parse(x.Date) : NaN;
      if (!Number.isFinite(t)) continue;
      const v = num(x.Value);
      rows.push({
        time: new Date(t), station, parameterId, parameterCode, func, depthM,
        value: v == null || v <= MISSING ? null : v,
        qualityCode: num(x.QualityCode),
      });
    }
  }
  return rows;
}

/**
 * One row per key (station, parameter, function, depth, time), the last one kept. The catalogue lists
 * some series twice (Cortegada's and Ribeira's 10-minute current, identical, 19-oct), and two equal
 * keys in one INSERT ... ON CONFLICT DO UPDATE make PostgreSQL reject the whole batch.
 */
export function dedupePlatformRows(rows: PlatformRow[]): { rows: PlatformRow[]; repeated: number } {
  const byKey = new Map<string, PlatformRow>();
  for (const r of rows) byKey.set(`${r.station}|${r.parameterId}|${r.func}|${r.depthM}|${r.time.getTime()}`, r);
  return { rows: [...byKey.values()], repeated: rows.length - byKey.size };
}

/** The same for CTD rows, by (cast, scan, parameter). */
export function dedupeCtdRows(rows: CtdRow[]): CtdRow[] {
  const byKey = new Map<string, CtdRow>();
  for (const r of rows) byKey.set(`${r.castId}|${r.scan}|${r.parameter}`, r);
  return [...byKey.values()];
}

export interface CastRef {
  castId: number;
  station: string;
  castDate: string;   // as published, without a zone
}

/** /ctd/cast/lasts: [{IdCast, StationCode, CastDate, ConfigCTDName}]. */
export function castRefs(payload: unknown): CastRef[] {
  if (!Array.isArray(payload)) return [];
  const out: CastRef[] = [];
  for (const c of payload as Array<Record<string, unknown>>) {
    const castId = num(c.IdCast);
    if (castId == null || typeof c.StationCode !== 'string' || typeof c.CastDate !== 'string') continue;
    out.push({ castId, station: c.StationCode, castDate: c.CastDate });
  }
  return out;
}

export interface CtdRow {
  castId: number;
  station: string;
  castDate: string;
  configName: string | null;
  scan: number;
  parameter: string;
  value: number | null;
  qualityFlag: number | null;
  units: string | null;
}

/**
 * /ctd/data/{station}: casts with `Scans` of {Scan, Parameters: {name: {Value, QualityFlag, Units}}}.
 * Every scan is kept, including the first ones taken out of the water (pressure ~0.25 dbar, salinity
 * ~1, QualityFlag 0): filtering is for whoever reads the table, with the pressure at hand.
 */
export function ctdRows(payload: unknown): CtdRow[] {
  if (!Array.isArray(payload)) return [];
  const rows: CtdRow[] = [];
  for (const c of payload as Array<Record<string, unknown>>) {
    const castId = num(c.IdCast);
    if (castId == null || typeof c.StationCode !== 'string' || typeof c.CastDate !== 'string' || !Array.isArray(c.Scans)) continue;
    const configName = typeof c.ConfigCTDName === 'string' ? c.ConfigCTDName : null;
    for (const s of c.Scans as Array<Record<string, unknown>>) {
      const scan = num(s.Scan);
      if (scan == null || s.Parameters == null || typeof s.Parameters !== 'object') continue;
      for (const [parameter, p] of Object.entries(s.Parameters as Record<string, Record<string, unknown>>)) {
        if (p == null || typeof p !== 'object') continue;
        rows.push({
          castId, station: c.StationCode, castDate: c.CastDate, configName, scan, parameter,
          value: num(p.Value), qualityFlag: num(p.QualityFlag),
          units: typeof p.Units === 'string' && p.Units !== '' ? p.Units : null,
        });
      }
    }
  }
  return rows;
}

/** The casts not yet stored, grouped as one request per station and day. */
export function castDaysToFetch(refs: CastRef[], stored: Set<number>): Array<{ station: string; day: string }> {
  const seen = new Set<string>();
  const out: Array<{ station: string; day: string }> = [];
  for (const r of refs) {
    if (stored.has(r.castId)) continue;
    const day = r.castDate.slice(0, 10);
    const key = `${r.station}|${day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ station: r.station, day });
  }
  return out;
}

/**
 * Expiry of the access token from its JWT `exp` (seconds), minus a 5-minute margin. The token
 * carries no `iat` and the login answer no `expires_in`; it lasted 3 h on 19-oct. Unreadable →
 * 1 h from now, so a bad token is replaced rather than trusted.
 */
export function tokenExpiryMs(token: string, nowMs: number): number {
  try {
    const part = token.split('.')[1] ?? '';
    const json = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { exp?: unknown };
    if (typeof json.exp === 'number' && Number.isFinite(json.exp)) return json.exp * 1000 - 5 * 60_000;
  } catch {
    // fall through
  }
  return nowMs + 3_600_000;
}
