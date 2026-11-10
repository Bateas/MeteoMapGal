/**
 * MeteoGalicia's official warnings, kept with their start and end.
 *
 * Until 10-nov only the browser read the feed, so nothing remembered which warnings there had
 * been: the review of the storm predictor could not ask «was there an official warning then?».
 * One request every 30 min to the official RSS (rssAdversos.action, the service MeteoGalicia
 * lists for third parties), parsed with the map's own parser. 48 requests a day.
 *
 * Nothing reads the table yet. It never sends anything: the map still shows warnings from the feed.
 */
import { parseWarningsXML } from '../src/api/mgWarningsClient.js';
import { SERVER_USER_AGENT } from '../src/config/serverIdentity.js';
import { getPool } from './db.js';
import { log } from './logger.js';
import * as mgBreaker from './mgBreaker.js';
import { describeLevels, warningInsertParts, warningRows } from './mgWarningsArchiveLogic.js';

export const MG_WARNINGS_EVERY_MS = 30 * 60_000;
const FEED_URL = 'https://servizos.meteogalicia.gal/mgrss/predicion/rssAdversos.action?request_locale=gl';
const TIMEOUT_MS = 15_000;
const QUIET_LOG_MS = 6 * 3_600_000;

let running = false;
let disabled = false;
let quietLoggedAt = 0;

/** Fire-and-forget from index.ts. Never throws. */
export async function runMgWarningsArchive(nowMs = Date.now()): Promise<void> {
  if (running || disabled || mgBreaker.isOpen()) return;
  running = true;
  try {
    const res = await fetch(FEED_URL, { headers: { 'User-Agent': SERVER_USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      log.warn(`[Avisos MG] HTTP ${res.status}: sin guardar esta pasada`);
      return;
    }
    const xml = await res.text();
    // An answer that is not the feed (an error page with 200) must not read as «no warnings».
    if (!xml.includes('<rss') && !xml.includes('<channel')) {
      log.warn('[Avisos MG] la respuesta no es el RSS de avisos: sin guardar esta pasada');
      return;
    }
    const { rows, skipped } = warningRows(parseWarningsXML(xml));
    if (rows.length === 0) {
      if (nowMs - quietLoggedAt >= QUIET_LOG_MS) {
        quietLoggedAt = nowMs;
        log.info(`[Avisos MG] sin avisos en el RSS${skipped ? ` (${skipped} tramos ilegibles)` : ''}`);
      }
      return;
    }
    const { tuples, values } = warningInsertParts(rows, new Date(nowMs));
    const out = await getPool().query<{ inserted: boolean }>(
      `INSERT INTO mg_warnings (type_id, zone_id, level, start_time, end_time, type, zone, comment, published_at, last_seen)
       VALUES ${tuples.join(',')}
       ON CONFLICT (type_id, zone_id, level, start_time, end_time)
       DO UPDATE SET last_seen = EXCLUDED.last_seen, comment = EXCLUDED.comment, published_at = EXCLUDED.published_at
       RETURNING (xmax = 0) AS inserted`,
      values,
    );
    const added = out.rows.filter((r) => r.inserted).length;
    if (added > 0 || nowMs - quietLoggedAt >= QUIET_LOG_MS) {
      quietLoggedAt = nowMs;
      log.info(`[Avisos MG] ${rows.length} tramos en el RSS (${describeLevels(rows)}), ${added} nuevos${skipped ? `, ${skipped} ilegibles` : ''}`);
    }
  } catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === '42P01' || e.code === '42703') {
      disabled = true;
      log.warn('[Avisos MG] falta la tabla mg_warnings: aplicar ingestor/schema.sql en la base; el archivo queda parado hasta el proximo reinicio');
    } else {
      log.warn(`[Avisos MG] fallo: ${e.message}`);
    }
  } finally {
    running = false;
  }
}
