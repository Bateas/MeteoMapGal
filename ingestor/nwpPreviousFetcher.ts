/**
 * Stores what the weather model said the day before at the five buoys of the wind model
 * (nwpPreviousLogic.ts has the why and the measured gain) in nwp_previous_hourly.
 *
 * Cost: one request for the five points every 6 h (20 coordinate-calls a day against the Open-Meteo
 * free tier), plus one request with the whole history the first time. Goes through the same breaker as
 * every other Open-Meteo call: the daily quota is shared with the forecast and the convection grid.
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
  nwpFetchWindow,
  nwpPoints,
  parsePreviousRuns,
  NWP_LEAD_DAYS,
  type NwpPreviousRow,
} from './nwpPreviousLogic.js';

export const NWP_PREVIOUS_INTERVAL_MS = 6 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 30_000;       // the first request brings seven months
const CHUNK = 500;

async function oldestStored(): Promise<number | null> {
  const r = await getPool().query<{ oldest: Date | null }>(
    'SELECT min(valid_time) AS oldest FROM nwp_previous_hourly WHERE lead_days = $1',
    [NWP_LEAD_DAYS],
  );
  const v = r.rows[0]?.oldest;
  return v ? new Date(v).getTime() : null;
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
    const points = nwpPoints();
    const now = Date.now();
    const win = nwpFetchWindow(await oldestStored(), now);
    const res = await fetch(buildPreviousRunsUrl(points, win.start, win.end), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      if (res.status === 429) reportOpenMeteoRateLimit('nwp-previous');
      log.warn(`[NWP] Open-Meteo previous runs ${res.status}`);
      return;
    }
    reportOpenMeteoSuccess();
    const rows = parsePreviousRuns(await res.json(), points, now);
    const written = await persist(rows);
    const last = rows.reduce((m, r) => Math.max(m, r.validTime.getTime()), 0);
    // Heartbeat on every cycle: silence would read as "not running".
    log.ok(`[NWP] prevision de la vispera: ${rows.length} horas recibidas, ${written} nuevas o cambiadas `
      + `(${points.length} boyas, ${win.start} a ${last ? new Date(last).toISOString().slice(0, 13) + 'h' : '-'}${win.backfill ? ', historico completo' : ''})`);
  } catch (err) {
    // Never fatal: a missing forecast only means the wind model predicts without it.
    log.warn(`[NWP] ciclo fallido: ${(err as Error).message}`);
  }
}
