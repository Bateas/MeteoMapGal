/**
 * Stores what the weather model said the day before at the five buoys of the wind model and at every
 * spot (nwpPreviousLogic.ts has the why and the measured gain) in nwp_previous_hourly.
 *
 * Cost: one request for all the points every 6 h (5 buoys + 14 spots = 19 coordinates, ~76
 * coordinate-calls a day against the Open-Meteo free tier), plus one request with the whole history for
 * the points that do not have it yet (once). Goes through the same breaker as every other Open-Meteo
 * call: the daily quota is shared with the forecast and the convection grid.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import {
  isOpen as isOpenMeteoBreakerOpen,
  reportRateLimit as reportOpenMeteoRateLimit,
  reportSuccess as reportOpenMeteoSuccess,
} from './openMeteoBreaker.js';
import {
  buildPreviousRunsUrl,
  nwpAllPoints,
  nwpFetchPlan,
  parsePreviousRuns,
  NWP_LEAD_DAYS,
  type NwpPreviousRow,
  type NwpRequest,
} from './nwpPreviousLogic.js';

export const NWP_PREVIOUS_INTERVAL_MS = 6 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 30_000;
const BACKFILL_TIMEOUT_MS = 90_000;    // seven months for every new point in one reply
const CHUNK = 500;

/** Oldest stored hour per point: a point missing here has no history yet. */
async function oldestByPoint(): Promise<Map<string, number>> {
  const r = await getPool().query<{ point: string; oldest: Date }>(
    'SELECT point, min(valid_time) AS oldest FROM nwp_previous_hourly WHERE lead_days = $1 GROUP BY point',
    [NWP_LEAD_DAYS],
  );
  return new Map(r.rows.map((row) => [row.point, new Date(row.oldest).getTime()]));
}

async function persist(rows: NwpPreviousRow[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const r of part) {
      values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
      params.push(r.validTime, r.point, r.leadDays, r.windKt, r.windDir, r.gustKt);
    }
    // A value that differs updates: the archive can still settle an hour whose day-before run arrived late.
    // Identical values are not rewritten, so the count below is what actually changed.
    const res = await getPool().query(
      `INSERT INTO nwp_previous_hourly (valid_time, point, lead_days, wind_kt, wind_dir, gust_kt)
       VALUES ${values.join(', ')}
       ON CONFLICT (valid_time, point, lead_days) DO UPDATE
         SET wind_kt = EXCLUDED.wind_kt, wind_dir = EXCLUDED.wind_dir, gust_kt = EXCLUDED.gust_kt, fetched_at = NOW()
         WHERE (nwp_previous_hourly.wind_kt, nwp_previous_hourly.wind_dir, nwp_previous_hourly.gust_kt)
               IS DISTINCT FROM (EXCLUDED.wind_kt, EXCLUDED.wind_dir, EXCLUDED.gust_kt)`,
      params,
    );
    written += res.rowCount ?? 0;
  }
  return written;
}

export async function runNwpPreviousCycle(): Promise<void> {
  if (isOpenMeteoBreakerOpen()) {
    log.info('[NWP] Open-Meteo en pausa (cuota): la prevision de la vispera espera al siguiente ciclo');
    return;
  }
  try {
    const now = Date.now();
    const plan = nwpFetchPlan(nwpAllPoints(), await oldestByPoint(), now);
    for (const req of plan) {
      if (!(await runRequest(req, now))) return;   // a 429 or an error: the next cycle retries
    }
  } catch (err) {
    // Never fatal: a missing forecast only means the wind model predicts without it.
    log.warn(`[NWP] ciclo fallido: ${(err as Error).message}`);
  }
}

async function runRequest(req: NwpRequest, now: number): Promise<boolean> {
  const res = await fetch(buildPreviousRunsUrl(req.points, req.start, req.end), {
    signal: AbortSignal.timeout(req.backfill ? BACKFILL_TIMEOUT_MS : FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    if (res.status === 429) reportOpenMeteoRateLimit('nwp-previous');
    log.warn(`[NWP] Open-Meteo previous runs ${res.status}${req.backfill ? ' (historico)' : ''}`);
    return false;
  }
  reportOpenMeteoSuccess();
  const rows = parsePreviousRuns(await res.json(), req.points, now);
  const written = await persist(rows);
  const last = rows.reduce((m, r) => Math.max(m, r.validTime.getTime()), 0);
  const buoys = req.points.filter((p) => p.id.startsWith('boya:')).length;
  // Heartbeat on every request: silence would read as "not running".
  log.ok(`[NWP] prevision de la vispera: ${rows.length} horas recibidas, ${written} nuevas o cambiadas `
    + `(${buoys} boyas + ${req.points.length - buoys} spots, ${req.start} a `
    + `${last ? new Date(last).toISOString().slice(0, 13) + 'h' : '-'}${req.backfill ? ', historico completo' : ''})`);
  return true;
}
