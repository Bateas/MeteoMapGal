/**
 * Read side of the SHADOW archive of MeteoGalicia's 2 m wind (table mg_aux_readings).
 *
 * One use only: the popup of THAT station shows its last 2 m reading as what it is (wind among the
 * crops, not the wind on the water). Nothing else may read it: not the scoring engine, not the
 * consensus, not the map arrows or the wind field, not the ticker nor the alerts. The data is not
 * validated (see src/api/mgAux2m.ts); a guard test fails if it spreads.
 *
 * Read-only, parameterized, with a short memo per station. A missing table (schema not applied yet)
 * is an expected state: it answers "no reading", never a 500.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import { memoByKey } from './singleFlight.js';

/** Older than this is not "the wind now" and is not shown. */
export const MG_AUX_MAX_AGE_MIN = 30;
/** How long one station's answer is remembered (the archive gets a row every 10 min). */
export const MG_AUX_MEMO_MS = 60_000;

export interface MgAuxLatest {
  stationId: string;
  time: string;              // ISO UTC, end of the 10-min period
  wind2m: number | null;     // m/s, 10-min mean at 2 m (often missing)
  gust2m: number | null;     // m/s
  dir2m: number | null;      // degrees, from
}

interface MgAuxRow {
  time: Date | string;
  wind_2m: number | string | null;
  gust_2m: number | string | null;
  dir_2m: number | string | null;
}

/** `mg_<digits>` as stored, or null for anything else (never reaches the SQL). */
export function parseMgAuxStationId(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return /^mg_\d{1,8}$/.test(id) ? id : null;
}

const num = (v: number | string | null, min: number, max: number): number | null => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

/** One DB row to the API shape, or null when it carries no wind at all (pure, tested). */
export function rowToMgAuxLatest(stationId: string, row: MgAuxRow | undefined): MgAuxLatest | null {
  if (!row) return null;
  const time = row.time instanceof Date ? row.time : new Date(row.time);
  if (Number.isNaN(time.getTime())) return null;
  const out: MgAuxLatest = {
    stationId,
    time: time.toISOString(),
    wind2m: num(row.wind_2m, 0, 60),
    gust2m: num(row.gust_2m, 0, 60),
    dir2m: num(row.dir_2m, 0, 360),
  };
  return out.wind2m == null && out.gust2m == null ? null : out;
}

let missingTableSaid = false;

/** Testing only. */
export function __resetMgAuxLatestForTests(): void {
  missingTableSaid = false;
}

export async function queryMgAuxLatestUncached(stationId: string): Promise<MgAuxLatest | null> {
  try {
    const res = await getPool().query<MgAuxRow>(
      `SELECT time, wind_2m, gust_2m, dir_2m
         FROM mg_aux_readings
        WHERE station_id = $1
          AND time > NOW() - ($2 || ' minutes')::INTERVAL
        ORDER BY time DESC
        LIMIT 1`,
      [stationId, String(MG_AUX_MAX_AGE_MIN)],
    );
    return rowToMgAuxLatest(stationId, res.rows[0]);
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') {
      if (!missingTableSaid) {
        missingTableSaid = true;
        log.warn('[MG 2 m sombra] falta la tabla mg_aux_readings: el popup no muestra el viento a 2 m');
      }
      return null;
    }
    throw err;
  }
}

/** Memoized per station; a failed query stores nothing. */
export const queryMgAuxLatest = memoByKey(MG_AUX_MEMO_MS, queryMgAuxLatestUncached, (id: string) => id);
