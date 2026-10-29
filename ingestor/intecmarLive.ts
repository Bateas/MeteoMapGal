/**
 * Live readings of the Observatorio Costeiro platforms from api.intecmar.gal (21-oct-2026: INTECMAR no
 * longer offers them through MeteoGalicia). Every INTECMAR_LIVE_MS (default 30 min, as agreed with INTECMAR on 29-oct; never below 10) it
 * asks only the series the map and the engine read (intecmarLiveLogic.livePlan: 37 requests), over today
 * UTC (and yesterday before 01:00 UTC), and:
 *   - keeps one reading per platform, with the shape of the MeteoGalicia path and source 'intecmar';
 *     fetchBuoyObservations merges it with that path's row every poll (mergeXuntaReadings: the newer
 *     row wins field by field, the older fills its gaps);
 *   - upserts everything it received into intecmar_platform (whole days: the night then only asks what
 *     is still missing, intecmarArchive.ts).
 * The MeteoGalicia path keeps running alongside, for the audit (the log line compares both).
 *
 * Session, pace and daily cap are the client's (intecmarClient.ts), shared with the night: one login
 * every ~3 h, wrong credentials stop both until a restart, and a pass that does not fit in what is left
 * of INTECMAR_MAX_REQUESTS_PER_DAY is skipped with the day's single warning line.
 * Switch off with INTECMAR_LIVE=0. Fire-and-forget: it never throws and never holds the poll.
 */
import type { BuoyReadingRow } from './db.js';
import { log } from './logger.js';
import { dedupePlatformRows, platformRows, type PlatformRow } from './intecmarLogic.js';
import { describePlatform, EMPTY_SKIP_LIVE_MS, INTECMAR_PLATFORMS, liveBuoyRow, liveEnabled, liveIntervalMs, livePlan, liveReading,
  liveWindow, noteSeriesAnswer, seriesDue, seriesKey } from './intecmarLiveLogic.js';
import { IntecmarAuthError, IntecmarBreakerError, IntecmarBudgetError, IntecmarSessionError, intecmarBreakerOpen, intecmarCredentials,
  intecmarGet, intecmarLedger, intecmarRequestsLeft, intecmarDailyCap, intecmarStopped, newPass, noteCapReached } from './intecmarClient.js';
import { insertPlatform } from './intecmarArchive.js';

/** Same staleness gate as the MeteoGalicia path (buoyFetcher MAX_AGE_MS). */
const MAX_AGE_MS = 6 * 60 * 60_000;

export function intecmarLiveIntervalMs(): number {
  return liveIntervalMs(process.env.INTECMAR_LIVE_MS);
}

let running = false;
let saidOff = false;
let saidStopped = false;
let tableMissing = false;
const latest = new Map<number, BuoyReadingRow>();
/** Series whose last answer was empty (a stopped sensor): not asked again until the time stored (6 h). */
const emptyRest = new Map<string, number>();

/** The newest live row of each platform still within the 6 h gate (read by fetchBuoyObservations). */
export function intecmarLiveReadings(nowMs = Date.now()): BuoyReadingRow[] {
  return [...latest.values()].filter((r) => nowMs - Date.parse(r.time) <= MAX_AGE_MS);
}

/** For tests. */
export function __resetIntecmarLiveForTests(): void {
  latest.clear();
  emptyRest.clear();
  running = false;
  saidOff = false;
  saidStopped = false;
  tableMissing = false;
}

/**
 * One live pass. `mgLastMs`: newest instant the MeteoGalicia path brought per buoy_readings station_id
 * (buoyFetcher.obsCosteiroLastTimes), only for the audit in the log line.
 */
export async function runIntecmarLive(mgLastMs: ReadonlyMap<number, number> = new Map(), nowMs = Date.now()): Promise<void> {
  if (running) return;
  if (!liveEnabled(process.env.INTECMAR_LIVE)) {
    if (!saidOff) log.info('[INTECMAR vivo] apagado (INTECMAR_LIVE=0): tiempo real de las plataformas solo por MeteoGalicia');
    saidOff = true;
    return;
  }
  if (!intecmarCredentials()) {
    if (!saidOff) log.info('[INTECMAR vivo] sin INTECMAR_USER / INTECMAR_PASSWORD en ingestor/.env: apagado');
    saidOff = true;
    return;
  }
  const stopped = intecmarStopped();
  if (stopped) {
    if (!saidStopped) log.warn(`[INTECMAR vivo] parado: ${stopped}; revisar credenciales y reiniciar`);
    saidStopped = true;
    return;
  }
  // The breaker's own line was written when it opened; the pass waits quietly.
  if (intecmarBreakerOpen(nowMs)) return;
  const plan = livePlan().filter((req) => seriesDue(emptyRest, seriesKey(req), nowMs));
  if (intecmarRequestsLeft(nowMs) < plan.length) {
    noteCapReached(nowMs);
    return;
  }

  running = true;
  const before = intecmarLedger(nowMs).ledger.current.byTag.vivo ?? 0;
  try {
    const { begin, end } = liveWindow(nowMs);
    const rows: PlatformRow[] = [];
    let failed = 0;
    let stoppedBy: string | null = null;
    const pass = newPass('vivo');
    for (const req of plan) {
      try {
        const payload = await intecmarGet(`/moorings/data/${req.station}/${req.parameterId}/10minute`,
          { begin_date: begin, end_date: end, function: req.func, format: 'JSON' }, pass);
        // The function is the one asked: a series that came back without its name keeps it.
        const got = platformRows(payload).map((r) => (r.func ? r : { ...r, func: req.func }));
        noteSeriesAnswer(emptyRest, seriesKey(req), got.length, Date.now(), EMPTY_SKIP_LIVE_MS);
        rows.push(...got);
      } catch (err) {
        if (err instanceof IntecmarAuthError) throw err;
        if (err instanceof IntecmarBudgetError) { stoppedBy = 'tope diario'; break; }
        if (err instanceof IntecmarBreakerError) { stoppedBy = 'fallos seguidos, en pausa'; break; }
        if (err instanceof IntecmarSessionError) { stoppedBy = 'token rechazado dos veces, pasada abortada'; break; }
        failed++;
      }
    }
    const resting = livePlan().length - plan.length;

    const at = Date.now();
    const parts: string[] = [];
    let served = 0;
    for (const p of INTECMAR_PLATFORMS) {
      const reading = liveReading(rows, p.code, at, MAX_AGE_MS);
      if (reading) {
        latest.set(p.canonicalId, liveBuoyRow(p, reading));
        served++;
      }
      parts.push(describePlatform(p.name, reading ? Date.parse(reading.time) : null, mgLastMs.get(p.canonicalId) ?? null, at));
    }

    let written = 0;
    const { rows: unique } = dedupePlatformRows(rows);
    if (!tableMissing && unique.length > 0) {
      try {
        written = await insertPlatform(unique);
      } catch (err) {
        const e = err as { code?: string; message: string };
        if (e.code === '42P01') {
          tableMissing = true;
          log.warn('[INTECMAR vivo] falta la tabla intecmar_platform (ingestor/schema.sql): se sirve el tiempo real sin guardarlo hasta el proximo reinicio');
        } else {
          log.warn(`[INTECMAR vivo] no se pudo guardar en intecmar_platform: ${e.message}`);
        }
      }
    }

    const asked = (intecmarLedger(at).ledger.current.byTag.vivo ?? 0) - before;
    const today = intecmarLedger(at).ledger.current.total;
    log.info(`[INTECMAR vivo] ${served}/${INTECMAR_PLATFORMS.length} plataformas · ${parts.join(' · ')} · ` +
      `${asked} peticiones${failed > 0 ? ` (${failed} fallaron)` : ''}${stoppedBy ? ` (cortado: ${stoppedBy})` : ''}${resting > 0 ? `, ${resting} series vacias en reposo` : ''}, hoy ${today}/${intecmarDailyCap()} · ` +
      `${written} filas guardadas`);
  } catch (err) {
    if (err instanceof IntecmarAuthError) {
      if (!saidStopped) log.warn(`[INTECMAR vivo] ${(err as Error).message}: archivo y tiempo real parados hasta el proximo reinicio (no se insiste para no bloquear la cuenta)`);
      saidStopped = true;
    } else {
      log.warn(`[INTECMAR vivo] fallo: ${(err as Error).message}`);
    }
  } finally {
    running = false;
  }
}
