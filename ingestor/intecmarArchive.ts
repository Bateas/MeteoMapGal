/**
 * INTECMAR archive: once a UTC day, the Observatorio Costeiro's own record of the five live platforms
 * (10-minute values with their quality code) and the CTD casts published since the last pass. Tables
 * intecmar_platform and intecmar_ctd (schema.sql). Plan and parsing in intecmarLogic.ts; requests in
 * intecmarClient.ts (shared with the live feed, intecmarLive.ts).
 *
 * What it is for: it is the clean history for calibration and ML (Cortegada lost 35-45 % of its readings
 * in buoy_readings, measured 19-oct) without touching buoy_readings, and it starts the history of the
 * water inside the rías (Rande at 1.5, 5.5 and 14 m; weekly CTD profiles at 43 stations).
 *
 * Incremental (21-oct): each of the 39 series is asked only from its first incomplete past day (with an
 * hour of overlap) to today (nightRange). The live feed writes today and yesterday whole, so on a normal
 * night only the two current series (not read live) are asked; a night or live feed that failed is
 * recovered from its own gap, up to 7 days back (never more: a stopped platform cannot grow the range).
 * A series with nothing stored gets the two days before; one whose answer comes back empty rests a week.
 * The CTD list is asked on Fridays (published on Thursdays), or when something is owed (shouldListCasts).
 *
 * Cadence: checked every hour, it runs once per UTC day after 01:00 UTC (and once more after a restart:
 * the coverage makes that repeat almost free). With a 1.5 s pause between requests. The history before
 * the lookback is NOT requested here: INTECMAR prefers to be told before any big download. Without
 * credentials it stays off with one line in the log. It never throws and never blocks the poll.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import { castDaysToFetch, castRefs, ctdRows, dedupeCtdRows, dedupePlatformRows, NIGHT_LOOKBACK_DAYS, nextDay, nightRange,
  platformPlan, platformRows, recoveryDays, shouldListCasts, type CtdRow, type DayCoverage, type PlatformRow } from './intecmarLogic.js';
import { describeDay, EMPTY_SKIP_NIGHT_MS, noteSeriesAnswer, seriesDue, seriesKey } from './intecmarLiveLogic.js';
import { IntecmarAuthError, IntecmarBreakerError, IntecmarBudgetError, IntecmarSessionError, intecmarCredentials, intecmarGet,
  intecmarBreakerOpen, intecmarLedger, newPass, type IntecmarPass } from './intecmarClient.js';

export const INTECMAR_CHECK_MS = 60 * 60_000;
const FIRST_HOUR_UTC = 1;
const CAST_LIST_SIZE = 60;
/** At most this many station-days of CTD per night: the first pass would otherwise ask ~60 at once. */
const MAX_CAST_DAYS_PER_PASS = 20;
const DAY_MS = 86_400_000;

let running = false;
let disabled = false;
let saidNoCredentials = false;
let attemptedDay: string | null = null;
/** Unknown after a restart, so the first night lists the casts once. */
let ctdOwed = true;
/** Series whose last night answer was empty: not asked again until the time stored (a week). */
const emptyRest = new Map<string, number>();

/** Errors that end the whole pass instead of costing one series. */
const abortsPass = (err: unknown) => err instanceof IntecmarAuthError || err instanceof IntecmarBudgetError
  || err instanceof IntecmarSessionError || err instanceof IntecmarBreakerError;

const P_COLS = 8;

/** Upsert of platform rows; shared with the live feed. Values never change at INTECMAR, codes may be refreshed. */
export async function insertPlatform(rows: PlatformRow[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const part = rows.slice(i, i + 1000);
    const values: unknown[] = [];
    const tuples = part.map((r, k) => {
      values.push(r.time, r.station, r.parameterId, r.func, r.depthM, r.parameterCode, r.value, r.qualityCode);
      return `(${Array.from({ length: P_COLS }, (_, c) => `$${k * P_COLS + c + 1}`).join(',')})`;
    });
    const res = await getPool().query(
      `INSERT INTO intecmar_platform (time, station_code, parameter_id, func, depth_m, parameter_code, value, quality_code)
       VALUES ${tuples.join(',')}
       ON CONFLICT (station_code, parameter_id, func, depth_m, time)
       DO UPDATE SET value = EXCLUDED.value, quality_code = EXCLUDED.quality_code, fetched_at = NOW()`,
      values,
    );
    written += res.rowCount ?? 0;
  }
  return written;
}

const C_COLS = 9;

async function insertCtd(rows: CtdRow[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const part = rows.slice(i, i + 1000);
    const values: unknown[] = [];
    const tuples = part.map((r, k) => {
      values.push(r.castId, r.station, r.castDate, r.configName, r.scan, r.parameter, r.value, r.qualityFlag, r.units);
      return `(${Array.from({ length: C_COLS }, (_, c) => `$${k * C_COLS + c + 1}`).join(',')})`;
    });
    const res = await getPool().query(
      `INSERT INTO intecmar_ctd (cast_id, station_code, cast_date, config_name, scan, parameter, value, quality_flag, units)
       VALUES ${tuples.join(',')}
       ON CONFLICT (cast_id, scan, parameter)
       DO UPDATE SET value = EXCLUDED.value, quality_flag = EXCLUDED.quality_flag, fetched_at = NOW()`,
      values,
    );
    written += res.rowCount ?? 0;
  }
  return written;
}

/**
 * Per series and past UTC day of the lookback: distinct instants, newest instant and newest fetch.
 * Bounded by time (chunk exclusion): ~39 series x 31 days of a small table.
 */
async function coverage(todayMs: number): Promise<Map<string, DayCoverage[]>> {
  const r = await getPool().query(
    `SELECT station_code, parameter_id, func, time_bucket('1 day', time) AS day,
            count(DISTINCT time)::int AS samples, max(time) AS last, max(fetched_at) AS fetched
       FROM intecmar_platform
      WHERE time >= $1 AND time < $2
      GROUP BY 1, 2, 3, 4`,
    [new Date(todayMs - NIGHT_LOOKBACK_DAYS * DAY_MS), new Date(todayMs)],
  );
  const out = new Map<string, DayCoverage[]>();
  for (const row of r.rows as Array<{ station_code: number; parameter_id: number; func: string; day: Date; samples: number; last: Date; fetched: Date }>) {
    const key = `${row.station_code}|${row.parameter_id}|${row.func}`;
    const list = out.get(key) ?? [];
    list.push({ dayMs: new Date(row.day).getTime(), samples: Number(row.samples), lastMs: new Date(row.last).getTime(), fetchedMs: new Date(row.fetched).getTime() });
    out.set(key, list);
  }
  return out;
}

async function platformPass(nowMs: number, pass: IntecmarPass): Promise<{ text: string; recovering: number }> {
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const cov = await coverage(today);
  const todo = platformPlan()
    .map((req) => ({ req, range: nightRange(cov.get(`${req.station}|${req.parameterId}|${req.func}`) ?? [], nowMs) }))
    .filter((x): x is { req: typeof x.req; range: { begin: string; end: string } } => x.range != null)
    .filter((x) => seriesDue(emptyRest, seriesKey(x.req), nowMs));
  const recovering = recoveryDays(todo.map((x) => x.range));
  const rows: PlatformRow[] = [];
  let failed = 0;
  for (const { req, range } of todo) {
    try {
      const payload = await intecmarGet(`/moorings/data/${req.station}/${req.parameterId}/10minute`,
        { begin_date: range.begin, end_date: range.end, function: req.func, format: 'JSON' }, pass);
      const got = platformRows(payload);
      noteSeriesAnswer(emptyRest, seriesKey(req), got.length, Date.now(), EMPTY_SKIP_NIGHT_MS);
      rows.push(...got);
    } catch (err) {
      if (abortsPass(err)) throw err;
      failed++;
      log.warn(`[INTECMAR] ${req.station}/${req.parameterId}/${req.func}: ${(err as Error).message}`);
    }
  }
  const skipped = platformPlan().length - todo.length;
  const resting = [...emptyRest.values()].filter((until) => until > nowMs).length;
  if (todo.length === 0) return { text: `plataformas: nada que pedir (${skipped} series completas o en reposo)`, recovering };
  const { rows: unique, repeated } = dedupePlatformRows(rows);
  const written = await insertPlatform(unique);
  const good = unique.filter((r) => r.qualityCode === 1).length;
  if (written < unique.length) log.warn(`[INTECMAR] plataformas: ${written} filas escritas de ${unique.length} leidas`);
  const begins = [...new Set(todo.map((x) => x.range.begin))].sort();
  return {
    text: `plataformas: ${todo.length} series pedidas (desde ${begins[0]}${begins.length > 1 ? ` .. ${begins[begins.length - 1]}` : ''}), ${skipped - resting} completas${resting > 0 ? `, ${resting} en reposo (vacias)` : ''}; ` +
      `${written} filas (${good} con codigo 1)${repeated > 0 ? `, ${repeated} repetidas` : ''}${failed > 0 ? `, ${failed} series fallaron` : ''}`,
    recovering,
  };
}

async function ctdPass(pass: IntecmarPass): Promise<string> {
  const refs = castRefs(await intecmarGet('/ctd/cast/lasts', { top: CAST_LIST_SIZE }, pass));
  if (refs.length === 0) return 'CTD: lista vacia';
  const ids = refs.map((r) => r.castId);
  const stored = await getPool().query('SELECT DISTINCT cast_id FROM intecmar_ctd WHERE cast_id = ANY($1::int[])', [ids]);
  const have = new Set<number>(stored.rows.map((r: { cast_id: number }) => r.cast_id));
  const pending = castDaysToFetch(refs, have);
  const todo = pending.slice(0, MAX_CAST_DAYS_PER_PASS);
  let written = 0;
  let casts = 0;
  let failed = 0;
  for (const { station, day } of todo) {
    try {
      const rows = dedupeCtdRows(ctdRows(await intecmarGet(`/ctd/data/${encodeURIComponent(station)}`, { begin_date: day, end_date: nextDay(day), format: 'JSON' }, pass)));
      casts += new Set(rows.map((r) => r.castId)).size;
      written += await insertCtd(rows);
    } catch (err) {
      if (abortsPass(err)) throw err;
      failed++;
      log.warn(`[INTECMAR] CTD ${station} ${day}: ${(err as Error).message}`);
    }
  }
  const left = pending.length - todo.length;
  ctdOwed = left > 0 || failed > 0;
  return `CTD: ${casts} perfiles nuevos (${written} filas) de ${refs.length} listados${left > 0 ? `, ${left} estacion-dia para la proxima noche` : ''}`;
}

function hhmmUtc(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16);
}

/** «ayer 2026-10-20: 2702 (noche 6, vivo 2696)», saying when the count started if the process restarted that day. */
function countsLine(nowMs: number): string {
  const { ledger, startedAt } = intecmarLedger(nowMs);
  const yesterday = new Date(Math.floor(nowMs / DAY_MS) * DAY_MS - DAY_MS).toISOString().slice(0, 10);
  const startedDay = new Date(startedAt).toISOString().slice(0, 10);
  const partial = (day: string) => (day === startedDay ? ` desde el arranque a las ${hhmmUtc(startedAt)} UTC` : '');
  const prev = ledger.previous && ledger.previous.day === yesterday
    ? `ayer ${describeDay(ledger.previous)}${partial(ledger.previous.day)}`
    : `ayer sin cuenta (arranque ${startedDay} ${hhmmUtc(startedAt)} UTC)`;
  return `peticiones a INTECMAR: ${prev}; hoy ${describeDay(ledger.current)}${partial(ledger.current.day)}`;
}

export async function runIntecmarArchive(nowMs = Date.now()): Promise<void> {
  if (running || disabled) return;
  if (!intecmarCredentials()) {
    if (!saidNoCredentials) log.info('[INTECMAR] sin INTECMAR_USER / INTECMAR_PASSWORD en ingestor/.env: archivo apagado');
    saidNoCredentials = true;
    return;
  }
  const now = new Date(nowMs);
  const day = now.toISOString().slice(0, 10);
  if (now.getUTCHours() < FIRST_HOUR_UTC || attemptedDay === day || intecmarBreakerOpen(nowMs)) return;
  running = true;
  attemptedDay = day;
  const before = intecmarLedger(nowMs).ledger.current.byTag.noche ?? 0;
  const asked = () => (intecmarLedger().ledger.current.byTag.noche ?? 0) - before;
  try {
    const pass = newPass('noche');
    const a = await platformPass(nowMs, pass);
    const b = shouldListCasts(nowMs, ctdOwed, a.recovering) ? await ctdPass(pass) : 'CTD: hoy no toca (se publican los jueves)';
    log.info(`[INTECMAR] noche: ${a.text}; ${b}; ${asked()} peticiones esta noche; ${countsLine(Date.now())}`);
  } catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === '42P01') {
      disabled = true;
      log.warn('[INTECMAR] faltan las tablas intecmar_platform / intecmar_ctd: aplicar ingestor/schema.sql en la base; el archivo queda parado hasta el proximo reinicio');
    } else if (err instanceof IntecmarAuthError) {
      disabled = true;
      log.warn(`[INTECMAR] ${e.message}: revisar INTECMAR_USER / INTECMAR_PASSWORD; archivo y tiempo real parados hasta el proximo reinicio (no se insiste para no bloquear la cuenta)`);
    } else if (err instanceof IntecmarBreakerError) {
      // The breaker's own line was written by the client; tried again in a later hour once it closes.
      ctdOwed = true;
      attemptedDay = null;
    } else if (err instanceof IntecmarBudgetError) {
      // The cap's own line was written by the client; what is missing is recovered the next night.
      ctdOwed = true;
    } else if (err instanceof IntecmarSessionError) {
      ctdOwed = true;
      log.warn(`[INTECMAR] noche abortada tras ${asked()} peticiones: ${e.message}; lo que falte se pide la proxima noche`);
    } else {
      ctdOwed = true;
      log.warn(`[INTECMAR] noche: fallo tras ${asked()} peticiones: ${e.message}`);
    }
  } finally {
    running = false;
  }
}
