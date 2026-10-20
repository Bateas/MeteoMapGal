/**
 * Recent precipitation of every station, for the map's «Lluvia ahora» layer.
 *
 * The layer decides whether a gauge is wet from how much its reading grew over the last 30 min,
 * and a day counter (wu_, mc_) needs a reading from before that window. A page opened a minute
 * ago has none of that history, so on 20-oct (first real front) a fresh page showed 1 wet gauge
 * where a page open for an hour showed ~20, and with no dry gauges to veto weak echo it drew more
 * rain too: two devices, two maps. This endpoint hands every page the same recent series.
 *
 * Read-only, one query for all stations, memoised for a minute (readings arrive every 5).
 */
import { getPool } from './db.js';
import { memoAsync } from './requestGuards.js';

/** The rain window is 30 min; a day counter needs a reading before it and Netatmo's rolling hour
 *  looks back 60 min, so 75 covers both with one ingest cycle to spare. */
export const RECENT_PRECIP_MIN = 75;
const MEMO_MS = 60_000;

interface PrecipRow {
  station_id: string;
  time: Date | string;
  precip: number | string | null;
}

/** station id -> [epoch ms, mm][] in time order, dropping anything that is not a reading (pure, tested). */
export function groupPrecipRows(rows: PrecipRow[]): Record<string, [number, number][]> {
  const out: Record<string, [number, number][]> = {};
  for (const r of rows) {
    if (typeof r.station_id !== 'string' || r.station_id.length === 0) continue;
    const t = (r.time instanceof Date ? r.time : new Date(r.time)).getTime();
    const mm = r.precip == null ? NaN : Number(r.precip);
    if (!Number.isFinite(t) || !Number.isFinite(mm) || mm < 0 || mm > 500) continue;
    (out[r.station_id] ??= []).push([t, mm]);
  }
  for (const list of Object.values(out)) list.sort((a, b) => a[0] - b[0]);
  return out;
}

export const queryRecentPrecip = memoAsync(MEMO_MS, async () => {
  const result = await getPool().query<PrecipRow>(
    `SELECT station_id, time, precip
       FROM readings
      WHERE time > NOW() - make_interval(mins => $1)
        AND precip IS NOT NULL
      ORDER BY station_id, time`,
    [RECENT_PRECIP_MIN],
  );
  return { windowMin: RECENT_PRECIP_MIN, stations: groupPrecipRows(result.rows) };
});
