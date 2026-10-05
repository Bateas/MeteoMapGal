/**
 * What the weather model said the day before, at the five buoys the wind model predicts and at every spot.
 *
 * Open-Meteo's Previous Runs API keeps, for every hour, "the value that was predicted 24 hours before
 * valid time" (`*_previous_day1`). That is a forecast which already existed when our wind model has to
 * speak about that hour, so it can be a feature without leaking the answer — unlike upper_air_hourly,
 * which is overwritten by newer runs until the hour is past.
 *
 * Measured on 28-sep (Mar-Sep, the model's rolling test month, same rows): with this forecast at the
 * target hour the afternoon error fell from 2.46 to 1.91 kt (bootstrap by day, 95 %: -0.78 to -0.36;
 * better on 27 of 31 days and at all five buoys). With the forecast from TWO days before it still fell
 * to 1.93: the gain is the forecast's, not a leak.
 *
 * The spots (28-sep): the same forecast at each spot, stored before the day it is for. It is the record
 * to check the forecast against what the spot measured (a front, a breeze), and an input a per-spot
 * model or the map engine can use later without leaking. Same request: one more coordinate per spot.
 *
 * Two more sets (6-oct), both for models that run in shadow before anything is shown:
 * - Three other weather models at the five buoys (ECMWF, GFS, UKMO). A neural candidate that reads the
 *   four day-before forecasts beat the production wind model on ten sealed days (1.90 against 2.38 kt in
 *   the afternoons, most of it in the front of 29-sep). Their points are '<model>@boya:<id>': they never
 *   start with 'boya', so the production model, which reads `point LIKE 'boya%'`, keeps reading only the
 *   default model.
 * - Temperature and cloud at the official stations of the overnight-minimum model (Ourense, 47 stations):
 *   the day-before minimum corrected by each station's recent bias cut the error from 1.73 to 1.28 C on
 *   3,004 nights. Points 'est:<station_id>', coordinates from the stations table.
 * Every point now also stores temperature and cloud: same request, same cost.
 *
 * Pure: URL, parsing and the fetch window. The fetcher does the I/O.
 */
import { RIAS_BUOY_STATIONS } from '../src/api/buoyClient.js';
import { ALL_SPOTS } from '../src/config/spots.js';

export const PREVIOUS_RUNS_URL = 'https://previous-runs-api.open-meteo.com/v1/forecast';

/** The buoys the ML zone model predicts (the ML pipeline common.TARGETS). */
export const NWP_BUOYS = [3221, 3223, 3220, 4272, 4273] as const;

/** 1 = predicted 24 h before the valid hour. The only lead stored today. */
export const NWP_LEAD_DAYS = 1;

/** History the model trains from (the ML pipeline common.TRAIN_START). One request brings it all. */
export const NWP_BACKFILL_START = '2026-03-01';

/** The station points only need the last weeks: a 30-night bias and last night's error. Shorter = fewer
 *  calls against the shared daily quota (47 stations x 7 weeks ~ 190 coordinate-calls once). */
export const NWP_STATION_BACKFILL_START = '2026-08-15';

/** Open-Meteo counts every coordinate and every two weeks of data as one call, and allows ~600 a minute:
 *  seven months for 12 points is ~190. History requests are split and at most two go per cycle; the rest
 *  wait for the next cycles. */
export const NWP_BACKFILL_MAX_POINTS = 12;
export const NWP_BACKFILL_MAX_REQUESTS = 2;

/** Hours ahead that are stored. The day-before value for an hour up to 18 h ahead comes from a run at
 *  least 6 h old, so it is already in the archive and will not change: the stored value is the final one,
 *  the same kind of value the backfill brings. */
export const NWP_MAX_AHEAD_H = 18;

/** Open-Meteo's default model (what 'boya:' and 'spot:' points have always stored). */
export const NWP_DEFAULT_MODEL = 'best_match';

/** The other models stored at the buoys, with the short key of their point ids. The same three the
 *  6-oct tournament used (Meteo-France only has this archive from August). */
export const NWP_EXTRA_MODELS = [
  { key: 'ecmwf', model: 'ecmwf_ifs025' },
  { key: 'gfs', model: 'gfs_seamless' },
  { key: 'ukmo', model: 'ukmo_seamless' },
] as const;

/** The official stations of Ourense the overnight-minimum model was measured on (1-oct, 47 stations). */
export const NWP_TMIN_STATIONS = [
  'aemet_1583X', 'aemet_1631E', 'aemet_1639X', 'aemet_1690A', 'aemet_1690B', 'aemet_1696O', 'aemet_1700X',
  'aemet_1701X', 'aemet_1706A', 'aemet_1735X', 'aemet_1738U', 'aemet_2969U', 'aemet_2978X',
  'mg_10048', 'mg_10057', 'mg_10058', 'mg_10109', 'mg_10110', 'mg_10111', 'mg_10112', 'mg_10113', 'mg_10114',
  'mg_10115', 'mg_10116', 'mg_10117', 'mg_10119', 'mg_10130', 'mg_10131', 'mg_10138', 'mg_10148', 'mg_10155',
  'mg_10204', 'mg_10500', 'mg_19026', 'mg_19027', 'mg_19030', 'mg_19031', 'mg_19032', 'mg_19033', 'mg_19037',
  'mg_19038', 'mg_19039', 'mg_19040', 'mg_19041', 'mg_19042', 'mg_19044', 'mg_19073',
] as const;

/**
 * 'boya:<station_id>' (read by the ML pipeline), 'spot:<spot_id>', '<model key>@boya:<station_id>' or
 * 'est:<station_id>'. `model` = Open-Meteo model (default best_match); `backfillStart` = how far back its
 * history goes (default NWP_BACKFILL_START).
 */
export interface NwpPoint { id: string; lat: number; lon: number; model?: string; backfillStart?: string }

export interface NwpPreviousRow {
  validTime: Date;
  point: string;
  leadDays: number;
  windKt: number | null;
  windDir: number | null;
  gustKt: number | null;
  tempC: number | null;
  cloudPct: number | null;
}

export function nwpPoints(): NwpPoint[] {
  return NWP_BUOYS.map((id) => {
    const b = RIAS_BUOY_STATIONS.find((s) => s.id === id);
    if (!b) throw new Error(`nwpPoints: la boya ${id} no esta en RIAS_BUOY_STATIONS`);
    return { id: `boya:${id}`, lat: b.lat, lon: b.lon };
  });
}

/** Every spot of both sectors, at the point its verdict is for (`center` is [lon, lat]). */
export function nwpSpotPoints(): NwpPoint[] {
  return ALL_SPOTS.map((sp) => ({ id: `spot:${sp.id}`, lat: sp.center[1], lon: sp.center[0] }));
}

/** Buoys and spots with the default model: also the point list of the WRF archive (wrfPointArchive). */
export function nwpAllPoints(): NwpPoint[] {
  return [...nwpPoints(), ...nwpSpotPoints()];
}

/** The five buoys again, once per extra model. */
export function nwpModelPoints(): NwpPoint[] {
  return NWP_EXTRA_MODELS.flatMap(({ key, model }) =>
    nwpPoints().map((p) => ({ ...p, id: `${key}@${p.id}`, model })));
}

/**
 * The overnight-minimum stations, from rows of the stations table. A station missing from the table, or
 * with coordinates outside Galicia, is left out: asking the model for the wrong place is worse than not
 * asking.
 */
export function nwpStationPoints(rows: ReadonlyArray<{ station_id: string; latitude: number | null; longitude: number | null }>): NwpPoint[] {
  const wanted = new Set<string>(NWP_TMIN_STATIONS);
  const out: NwpPoint[] = [];
  for (const r of rows) {
    if (!wanted.has(r.station_id)) continue;
    const lat = Number(r.latitude), lon = Number(r.longitude);
    if (!(lat > 41.8 && lat < 43.9 && lon > -9.4 && lon < -6.7)) continue;
    out.push({ id: `est:${r.station_id}`, lat, lon, backfillStart: NWP_STATION_BACKFILL_START });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const VARS = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'temperature_2m', 'cloud_cover'] as const;

/** All points of one request share a model: Open-Meteo answers one model per request with plain keys. */
export function buildPreviousRunsUrl(points: NwpPoint[], startDate: string, endDate: string, leadDays = NWP_LEAD_DAYS): string {
  const model = points[0]?.model ?? NWP_DEFAULT_MODEL;
  if (points.some((p) => (p.model ?? NWP_DEFAULT_MODEL) !== model)) {
    throw new Error('buildPreviousRunsUrl: puntos de modelos distintos en una peticion');
  }
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(','),
    longitude: points.map((p) => p.lon).join(','),
    hourly: VARS.map((v) => `${v}_previous_day${leadDays}`).join(','),
    start_date: startDate,
    end_date: endDate,
    wind_speed_unit: 'kn',
    timezone: 'GMT',
  });
  if (model !== NWP_DEFAULT_MODEL) params.set('models', model);
  return `${PREVIOUS_RUNS_URL}?${params}`;
}

interface PointPayload { hourly?: { time?: string[]; [k: string]: unknown } }

/**
 * One row per point and hour with a wind value, up to NWP_MAX_AHEAD_H past `nowMs`.
 * Several coordinates come back as an array in the order they were asked; one comes back as an object.
 * A count that does not match the points is refused: assigning series to the wrong buoy is worse than
 * storing nothing.
 */
export function parsePreviousRuns(json: unknown, points: NwpPoint[], nowMs: number, leadDays = NWP_LEAD_DAYS): NwpPreviousRow[] {
  const list: PointPayload[] = Array.isArray(json) ? json : [json as PointPayload];
  if (list.length !== points.length) {
    throw new Error(`parsePreviousRuns: ${list.length} series para ${points.length} puntos`);
  }
  const limit = nowMs + NWP_MAX_AHEAD_H * 3_600_000;
  const out: NwpPreviousRow[] = [];
  list.forEach((payload, i) => {
    const h = payload?.hourly;
    if (!h || !Array.isArray(h.time)) return;
    const col = (v: string): (number | null)[] => {
      const arr = h[`${v}_previous_day${leadDays}`];
      return Array.isArray(arr) ? (arr as (number | null)[]) : [];
    };
    const ws = col('wind_speed_10m'), wd = col('wind_direction_10m'), wg = col('wind_gusts_10m');
    const ta = col('temperature_2m'), cc = col('cloud_cover');
    const num = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : null);
    h.time.forEach((t, k) => {
      // timezone=GMT returns "2026-03-01T00:00" without a zone: it is UTC.
      const valid = new Date(`${t}:00Z`);
      if (Number.isNaN(valid.getTime()) || valid.getTime() > limit) return;
      const kt = ws[k];
      if (kt == null || !Number.isFinite(kt)) return;   // no value yet: nothing to store
      out.push({
        validTime: valid,
        point: points[i].id,
        leadDays,
        windKt: kt,
        windDir: wd[k] ?? null,
        gustKt: wg[k] ?? null,
        tempC: num(ta[k]),
        cloudPct: num(cc[k]),
      });
    });
  });
  return out;
}

export interface NwpRequest { points: NwpPoint[]; start: string; end: string; backfill: boolean; model: string }

/**
 * The requests of one cycle. Recent windows first, one per model (the default model, which the production
 * wind model reads, goes before anything else: a 429 later in the cycle cannot take it away). Then the
 * points that are new or do not reach their history start, in chunks of NWP_BACKFILL_MAX_POINTS, at most
 * NWP_BACKFILL_MAX_REQUESTS per cycle: a point waiting for its turn is asked on a later cycle, with its
 * whole history then.
 */
export function nwpFetchPlan(points: NwpPoint[], oldestByPoint: ReadonlyMap<string, number>, nowMs: number): NwpRequest[] {
  const recent = new Map<string, NwpRequest>();
  const history = new Map<string, NwpRequest>();
  for (const p of points) {
    const model = p.model ?? NWP_DEFAULT_MODEL;
    const win = nwpFetchWindow(oldestByPoint.get(p.id) ?? null, nowMs, p.backfillStart);
    const groups = win.backfill ? history : recent;
    const key = `${model}|${win.start}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { points: [], start: win.start, end: win.end, backfill: win.backfill, model }));
    g.points.push(p);
  }
  const byDefaultFirst = (a: NwpRequest, b: NwpRequest) =>
    Number(b.model === NWP_DEFAULT_MODEL) - Number(a.model === NWP_DEFAULT_MODEL);
  const chunks: NwpRequest[] = [];
  for (const g of [...history.values()].sort(byDefaultFirst)) {
    for (let i = 0; i < g.points.length; i += NWP_BACKFILL_MAX_POINTS) {
      chunks.push({ ...g, points: g.points.slice(i, i + NWP_BACKFILL_MAX_POINTS) });
    }
  }
  return [...[...recent.values()].sort(byDefaultFirst), ...chunks.slice(0, NWP_BACKFILL_MAX_REQUESTS)];
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Dates to ask for. Normally the last two days and tomorrow, which also refills a gap left by a failed
 * cycle. When the table does not reach back to the point's history start yet, the whole history.
 */
export function nwpFetchWindow(oldestStoredMs: number | null, nowMs: number, backfillStart = NWP_BACKFILL_START): { start: string; end: string; backfill: boolean } {
  const end = isoDate(nowMs + 86_400_000);
  const backfillFrom = Date.parse(`${backfillStart}T00:00:00Z`);
  if (oldestStoredMs == null || oldestStoredMs > backfillFrom + 86_400_000) {
    return { start: backfillStart, end, backfill: true };
  }
  return { start: isoDate(nowMs - 2 * 86_400_000), end, backfill: false };
}
