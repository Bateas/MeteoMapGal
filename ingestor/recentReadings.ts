/**
 * The last hours of every station's readings, for the page's in-memory history.
 *
 * Until v2.191.0 the page filled that history with 24 h of Open-Meteo MODEL values stamped with
 * each station's id (one request per 0.1-degree node, ~25 per visitor, one every ~1.5 s). The
 * sparklines, the 3 h charts and the trend detectors then read model numbers as if the station
 * had measured them. The readings are in our own table: this hands them over in one answer.
 *
 * Read-only, one query for all stations, memoised for two minutes (readings arrive every 5).
 * Compact rows: [epoch ms, wind m/s, gust m/s, dir deg, temp C, hum %, pressure hPa, dew C,
 * solar W/m2, precip mm], nulls kept, one decimal.
 */
import { getPool } from './db.js';
import { memoAsync } from './requestGuards.js';

/** The in-memory charts reach 3 h back and the sparklines 2 h; the detectors look at 30-60 min. */
export const RECENT_READINGS_MIN = 180;
const MEMO_MS = 120_000;

export const RECENT_FIELDS = ['t', 'wind', 'gust', 'dir', 'temp', 'hum', 'pres', 'dew', 'solar', 'precip'] as const;

interface ReadingRowIn {
  station_id: string;
  time: Date | string;
  wind_speed: number | string | null;
  wind_gust: number | string | null;
  wind_dir: number | string | null;
  temperature: number | string | null;
  humidity: number | string | null;
  pressure: number | string | null;
  dew_point: number | string | null;
  solar_rad: number | string | null;
  precip: number | string | null;
}

type Cell = number | null;

function num(v: number | string | null): Cell {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

/** station id -> rows in time order; rows without a valid time or without any value are dropped (pure, tested). */
export function groupRecentRows(rows: ReadingRowIn[]): Record<string, Cell[][]> {
  const out: Record<string, Cell[][]> = {};
  for (const r of rows) {
    if (typeof r.station_id !== 'string' || r.station_id.length === 0) continue;
    const t = (r.time instanceof Date ? r.time : new Date(r.time)).getTime();
    if (!Number.isFinite(t)) continue;
    const values = [r.wind_speed, r.wind_gust, r.wind_dir, r.temperature, r.humidity, r.pressure, r.dew_point, r.solar_rad, r.precip].map(num);
    if (values.every((v) => v == null)) continue;
    (out[r.station_id] ??= []).push([t, ...values]);
  }
  for (const list of Object.values(out)) list.sort((a, b) => (a[0] as number) - (b[0] as number));
  return out;
}

export const queryRecentReadings = memoAsync(MEMO_MS, async () => {
  const result = await getPool().query<ReadingRowIn>(
    `SELECT station_id, time, wind_speed, wind_gust, wind_dir, temperature, humidity,
            pressure, dew_point, solar_rad, precip
       FROM readings
      WHERE time > NOW() - make_interval(mins => $1)
      ORDER BY station_id, time`,
    [RECENT_READINGS_MIN],
  );
  return { windowMin: RECENT_READINGS_MIN, fields: RECENT_FIELDS, stations: groupRecentRows(result.rows) };
});
