/**
 * What the weather model said the day before, at the five buoys the wind model predicts.
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
 * Pure: URL, parsing and the fetch window. The fetcher does the I/O.
 */
import { RIAS_BUOY_STATIONS } from '../src/api/buoyClient.js';

export const PREVIOUS_RUNS_URL = 'https://previous-runs-api.open-meteo.com/v1/forecast';

/** The buoys the ML zone model predicts (MeteoMap-ml common.TARGETS). */
export const NWP_BUOYS = [3221, 3223, 3220, 4272, 4273] as const;

/** 1 = predicted 24 h before the valid hour. The only lead stored today. */
export const NWP_LEAD_DAYS = 1;

/** History the model trains from (MeteoMap-ml common.TRAIN_START). One request brings it all. */
export const NWP_BACKFILL_START = '2026-03-01';

/** Hours ahead that are stored. The day-before value for an hour up to 18 h ahead comes from a run at
 *  least 6 h old, so it is already in the archive and will not change: the stored value is the final one,
 *  the same kind of value the backfill brings. */
export const NWP_MAX_AHEAD_H = 18;

export interface NwpPoint { id: string; buoyId: number; lat: number; lon: number }

export interface NwpPreviousRow {
  validTime: Date;
  point: string;
  leadDays: number;
  windKt: number | null;
  windDir: number | null;
  gustKt: number | null;
}

export function nwpPoints(): NwpPoint[] {
  return NWP_BUOYS.map((id) => {
    const b = RIAS_BUOY_STATIONS.find((s) => s.id === id);
    if (!b) throw new Error(`nwpPoints: la boya ${id} no esta en RIAS_BUOY_STATIONS`);
    return { id: `boya:${id}`, buoyId: id, lat: b.lat, lon: b.lon };
  });
}

const VARS = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'] as const;

export function buildPreviousRunsUrl(points: NwpPoint[], startDate: string, endDate: string, leadDays = NWP_LEAD_DAYS): string {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(','),
    longitude: points.map((p) => p.lon).join(','),
    hourly: VARS.map((v) => `${v}_previous_day${leadDays}`).join(','),
    start_date: startDate,
    end_date: endDate,
    wind_speed_unit: 'kn',
    timezone: 'GMT',
  });
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
      });
    });
  });
  return out;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Dates to ask for. Normally the last two days and tomorrow, which also refills a gap left by a failed
 * cycle. When the table does not reach back to the training start yet, the whole history in one request.
 */
export function nwpFetchWindow(oldestStoredMs: number | null, nowMs: number): { start: string; end: string; backfill: boolean } {
  const end = isoDate(nowMs + 86_400_000);
  const backfillFrom = Date.parse(`${NWP_BACKFILL_START}T00:00:00Z`);
  if (oldestStoredMs == null || oldestStoredMs > backfillFrom + 86_400_000) {
    return { start: NWP_BACKFILL_START, end, backfill: true };
  }
  return { start: isoDate(nowMs - 2 * 86_400_000), end, backfill: false };
}
