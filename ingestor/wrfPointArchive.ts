/**
 * MeteoGalicia's WRF at the buoys and spots, archived every 12 h.
 *
 * The MeteoSIX API serves only the current run ("El intervalo temporal solicitado no puede
 * empezar antes del dia actual", code 213): a forecast that is not stored when it is issued is
 * lost. Until 29-sep only one point per sector was archived (forecast_archive, at the sector
 * centre, on land by Redondela). There the day-before WRF did not beat the global models, but a
 * 1 km model sees the shelter of a land point that coarser models do not, so the test was not
 * fair. To judge it where it matters it has to be kept at sea: at the five buoys of the wind
 * model, and at every spot.
 *
 * Rows go to forecast_archive with the point id as the sector ('boya:4272', 'spot:cesantes') and
 * model 'wrf': no schema change. WRF runs twice a day, so every 12 h is enough, and before asking
 * the last archived issue is read from the table, so restarts do not repeat the requests. About
 * 20 points, one after another, twice a day.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import { fetchWrfForecast, isMeteoSixConfigured } from './meteoSixFetcher.js';
import { buildArchiveRows, writeArchiveRows } from './forecastArchive.js';
import { nwpAllPoints } from './nwpPreviousLogic.js';

export const WRF_POINT_EVERY_MS = 12 * 3_600_000;
/** How often the ingestor asks whether a new archive is due (the table decides). */
export const WRF_POINT_CHECK_MS = 60 * 60_000;
/** Slack so an hourly check that lands a little early does not skip a whole run. */
const DUE_SLACK_MS = 30 * 60_000;
const PAUSE_MS = 1_500;

export function wrfPointArchiveDue(lastIssuedMs: number | null, nowMs: number): boolean {
  return lastIssuedMs == null || nowMs - lastIssuedMs >= WRF_POINT_EVERY_MS - DUE_SLACK_MS;
}

async function lastIssuedMs(): Promise<number | null> {
  const r = await getPool().query<{ t: Date | null }>(
    `SELECT max(issued_at) AS t FROM forecast_archive
      WHERE sector LIKE 'boya:%' AND model = 'wrf' AND issued_at > NOW() - INTERVAL '2 days'`,
  );
  const t = r.rows[0]?.t;
  return t ? new Date(t).getTime() : null;
}

let running = false;

/** Fire-and-forget from index.ts. Never throws; a point that fails is logged and skipped. */
export async function runWrfPointArchive(nowMs = Date.now()): Promise<void> {
  if (running || !isMeteoSixConfigured()) return;
  running = true;
  try {
    if (!wrfPointArchiveDue(await lastIssuedMs(), nowMs)) return;
    const fetchedAt = new Date(nowMs);
    const points = nwpAllPoints();
    let ok = 0;
    let rows = 0;
    for (const p of points) {
      try {
        const hours = await fetchWrfForecast(p.lat, p.lon);
        rows += await writeArchiveRows(buildArchiveRows(p.id, 'wrf', fetchedAt, hours));
        ok++;
      } catch (err) {
        log.warn(`[WRF puntos] ${p.id}: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
    log.info(`[WRF puntos] ${ok}/${points.length} puntos archivados, ${rows} horas nuevas`);
  } catch (err) {
    log.warn(`[WRF puntos] ciclo fallido: ${(err as Error).message}`);
  } finally {
    running = false;
  }
}
