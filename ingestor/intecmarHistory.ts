/**
 * INTECMAR history: the Observatorio Costeiro platforms' hourly record since August 2007, a month of one
 * series per request, at most a thousand requests a night (what we told INTECMAR on 29-oct), into
 * intecmar_platform_hourly. The months already asked live in intecmar_history_months, which is the whole
 * state: it goes on where it stopped after a restart, and Grafana reads it to show the progress. Plan and
 * rules in intecmarHistoryLogic.ts; requests through the shared client (intecmarClient.ts), so it shares
 * the pace, the daily cap and the breaker with the live feed and the night archive.
 *
 * Checked every hour, it runs only at night, between 02 and 07 UTC (after the night archive), once per
 * UTC day, and again after a restart that night with what is left of its budget; at 07 UTC it stops. A month whose series has no value at all is noted
 * as empty and stores nothing (before a platform existed, or a sensor it never had); a month with values
 * is kept as published, -9999 included as NULL with its code, like the 10-minute archive. Without
 * credentials or with INTECMAR_HISTORY=0 it stays off. It never throws and never blocks the poll.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import { insertPlatform } from './intecmarArchive.js';
import { describeDay, liveEnabled, liveIntervalMs, livePlan } from './intecmarLiveLogic.js';
import { historyBudget, historyPlan, historyQueue, liveReserve, monthRows, monthWindow,
  inHistoryWindow, type HistoryMonth, type HistoryStatus, type HistoryTask } from './intecmarHistoryLogic.js';
import { IntecmarAuthError, IntecmarBreakerError, IntecmarBudgetError, IntecmarSessionError, intecmarBreakerOpen,
  intecmarCredentials, intecmarGet, intecmarLedger, intecmarRequestsLeft, intecmarStopped, newPass } from './intecmarClient.js';

let running = false;
let disabled = false;
let saidOff = false;
let saidComplete = '';
let attemptedDay: string | null = null;

/** Errors that end the whole night instead of costing one month. */
const abortsNight = (err: unknown) => err instanceof IntecmarAuthError || err instanceof IntecmarBudgetError
  || err instanceof IntecmarSessionError || err instanceof IntecmarBreakerError;

async function loadLedger(): Promise<HistoryMonth[]> {
  const res = await getPool().query(
    `SELECT station_code, parameter_id, func, to_char(month, 'YYYY-MM') AS month, status, attempts,
            (extract(epoch FROM fetched_at) * 1000)::bigint AS fetched_ms
       FROM intecmar_history_months`,
  );
  return res.rows.map((r) => ({
    station: Number(r.station_code), parameterId: Number(r.parameter_id), func: String(r.func), month: String(r.month),
    status: r.status as HistoryStatus, attempts: Number(r.attempts), fetchedAtMs: Number(r.fetched_ms),
  }));
}

async function noteMonth(t: HistoryTask, status: HistoryStatus, rows: number, error: string | null): Promise<void> {
  await getPool().query(
    `INSERT INTO intecmar_history_months (station_code, parameter_id, func, month, status, hourly_rows, attempts, error, fetched_at)
     VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, NOW())
     ON CONFLICT (station_code, parameter_id, func, month) DO UPDATE SET
       status = EXCLUDED.status, hourly_rows = EXCLUDED.hourly_rows,
       attempts = intecmar_history_months.attempts + EXCLUDED.attempts, error = EXCLUDED.error, fetched_at = NOW()`,
    [t.series.station, t.series.parameterId, t.series.func, `${t.month}-01`, status, rows, status === 'error' ? 1 : 0, error],
  );
}

/** One month of one series: asked, kept and noted. A failed request throws (the caller notes it). */
async function askMonth(t: HistoryTask, pass: ReturnType<typeof newPass>): Promise<{ status: HistoryStatus; rows: number }> {
  const { begin, end } = monthWindow(t.month);
  const payload = await intecmarGet(`/moorings/data/${t.series.station}/${t.series.parameterId}/hourly`,
    { begin_date: begin, end_date: end, format: 'JSON', function: t.series.func }, pass);
  const inMonth = monthRows(payload, t.month);
  if (inMonth.length === 0) {
    await noteMonth(t, 'empty', 0, null);
    return { status: 'empty', rows: 0 };
  }
  const written = await insertPlatform(inMonth, 'intecmar_platform_hourly');
  await noteMonth(t, 'ok', written, null);
  return { status: 'ok', rows: written };
}

export async function runIntecmarHistory(nowMs = Date.now()): Promise<void> {
  if (running || disabled) return;
  if (!intecmarCredentials() || intecmarStopped() || !liveEnabled(process.env.INTECMAR_HISTORY)) {
    if (!saidOff) log.info('[INTECMAR historico] apagado (sin credenciales, cuenta parada o INTECMAR_HISTORY=0)');
    saidOff = true;
    return;
  }
  const now = new Date(nowMs);
  const day = now.toISOString().slice(0, 10);
  if (!inHistoryWindow(nowMs) || attemptedDay === day || intecmarBreakerOpen(nowMs)) return;
  running = true;
  attemptedDay = day;
  const counts = { ok: 0, empty: 0, error: 0, rows: 0 };
  let asked = 0;
  try {
    const done = await loadLedger();
    const startOfDay = Math.floor(nowMs / 86_400_000) * 86_400_000;
    const spentToday = done.filter((d) => d.fetchedAtMs >= startOfDay).length;
    const queue = historyQueue(done, nowMs);
    const total = done.length + queue.filter((t) => t.why === 'nuevo').length;
    if (queue.length === 0) {
      if (saidComplete !== day) log.info(`[INTECMAR historico] al dia: ${done.length} meses-serie guardados, nada pendiente`);
      saidComplete = day;
      return;
    }
    const reserve = liveReserve(nowMs, liveIntervalMs(process.env.INTECMAR_LIVE_MS), livePlan().length, liveEnabled(process.env.INTECMAR_LIVE));
    const budget = historyBudget(spentToday, intecmarRequestsLeft(nowMs), reserve);
    if (budget <= 0) {
      log.info(`[INTECMAR historico] hoy sin presupuesto (${spentToday} ya pedidas hoy, quedan ${intecmarRequestsLeft(nowMs)} y el tiempo real necesita ${reserve}); pendientes ${queue.length}`);
      return;
    }
    const pass = newPass('historico');
    let stoppedAtDawn = false;
    for (const t of queue.slice(0, budget)) {
      if (!inHistoryWindow(Date.now())) { stoppedAtDawn = true; break; }
      asked++;
      try {
        const r = await askMonth(t, pass);
        counts[r.status]++;
        counts.rows += r.rows;
      } catch (err) {
        if (abortsNight(err)) throw err;
        counts.error++;
        await noteMonth(t, 'error', 0, (err as Error).message.slice(0, 200));
      }
    }
    log.info(`[INTECMAR historico] noche${stoppedAtDawn ? ' (cortada a las 07 UTC)' : ''}: ${asked} peticiones (${counts.ok} meses con datos, ${counts.empty} vacios, ${counts.error} fallos), ${counts.rows} filas horarias; pendientes ${queue.length - asked} (total ${total} meses-serie de ${historyPlan().length} series); peticiones a INTECMAR hoy ${describeDay(intecmarLedger().ledger.current)}`);
  } catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === '42P01') {
      disabled = true;
      log.warn('[INTECMAR historico] faltan las tablas intecmar_platform_hourly / intecmar_history_months: aplicar ingestor/schema.sql en la base; parado hasta el proximo reinicio');
    } else if (err instanceof IntecmarBreakerError) {
      attemptedDay = null; // tried again in a later hour, once the breaker closes
    } else if (err instanceof IntecmarBudgetError) {
      // the client already wrote the cap line; the rest goes the next night
    } else if (err instanceof IntecmarAuthError) {
      disabled = true;
      log.warn(`[INTECMAR historico] ${e.message}: parado hasta el proximo reinicio`);
    } else {
      log.warn(`[INTECMAR historico] noche cortada tras ${asked} peticiones: ${e.message}; sigue la proxima noche donde lo dejo`);
    }
  } finally {
    running = false;
  }
}
