/**
 * Nightly judgement of the sensors (station health), IN SHADOW.
 *
 * Every night, before the calibration, the detectors (healthDetectors.ts) read the previous day
 * and store what failed (station_health_strikes). The rule of stationHealth.ts then says which
 * variables of which stations would be out: failures on 3 distinct days within 30, back after 14
 * clean days. For now it only says so in the log; nothing is removed, so the rules can be checked
 * against a few days of real output before anything depends on them.
 *
 * The first nights fill in the 30-day window, MAX_DAYS_PER_RUN days a night, oldest first; each
 * day is one query bounded to that day.
 *
 * Besides the one-day rules, each judged day runs «cambio brusco» (changePointLogic.ts): the
 * night against the station's own 30 previous nights, read from the hourly aggregate (~130 ms).
 * Every strike of it gets its own log line, so a sensor that breaks shows the same night.
 */
import { getPool, stationAltitudeSql } from './db.js';
import { log } from './logger.js';
import { madridHour } from '../src/services/localTime.js';
import { judgeHealth, outKeys, HEALTH_WINDOW_DAYS, type HealthVariable, type HealthVerdict } from '../src/services/stationHealth.js';
import { detectStrikes, type DetectedStrike, type HealthStation } from './healthDetectors.js';
import { changePointStrikes, CP_BASE_NIGHTS, type NightMean } from './changePointLogic.js';

export const HEALTH_CHECK_INTERVAL_MS = 60 * 60_000;
/** Local hours to run in: the previous day is complete, and the calibration comes at 03-06 h. */
export const HEALTH_SLOT: readonly [number, number] = [1, 3];
const MAX_DAYS_PER_RUN = 10;
const PAUSE_MS = 2_000;
const INSERT_CHUNK = 200;

/** Local day (Galicia) of an instant, YYYY-MM-DD. */
export function madridDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms));
}

/** The days of the window still to judge, oldest first. Today is not complete, so never today. */
export function daysToJudge(done: ReadonlySet<string>, today: string): string[] {
  const base = Date.parse(`${today}T00:00:00Z`);
  const out: string[] = [];
  for (let k = HEALTH_WINDOW_DAYS; k >= 1; k--) {
    const day = new Date(base - k * 86_400_000).toISOString().slice(0, 10);
    if (!done.has(day)) out.push(day);
  }
  return out;
}

/** One line for the log: what would be out, in shadow. */
export function shadowSummary(verdicts: readonly HealthVerdict[]): string {
  const out = verdicts.filter((v) => v.out);
  const stations = new Set(out.map((v) => v.stationId)).size;
  const head = `[Salud] en sombra (no se quita nada): ${out.length} variables fuera en ${stations} estaciones`;
  if (out.length === 0) return head;
  const shown = out.slice(0, 12).map((v) => `${v.stationId} ${v.variable} (${v.strikeDays} d: ${v.rules.join(', ')})`);
  return `${head} — ${shown.join('; ')}${out.length > 12 ? `; y ${out.length - 12} mas` : ''}`;
}

let running = false;
let disabled = false;
let lastOut: Set<string> | null = null;

async function doneDays(): Promise<Set<string>> {
  const r = await getPool().query<{ d: string }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS d FROM station_health_days WHERE day >= CURRENT_DATE - $1::int`,
    [HEALTH_WINDOW_DAYS + 2],
  );
  return new Set(r.rows.map((x) => x.d));
}

async function loadDay(day: string): Promise<{ stations: HealthStation[]; endMs: number }> {
  const db = getPool();
  const altitude = await stationAltitudeSql();
  const [rows, meta, end] = await Promise.all([
    db.query<{
      station_id: string; t: string; temperature: number | null; humidity: number | null; wind_speed: number | null;
      wind_gust: number | null; pressure: number | null; precip: number | null; solar_rad: number | null;
    }>(`
      SELECT station_id, (extract(epoch FROM time) * 1000)::bigint AS t,
             temperature, humidity, wind_speed, wind_gust, pressure, precip, solar_rad
        FROM readings
       WHERE time >= ($1::date)::timestamp AT TIME ZONE 'Europe/Madrid'
         AND time <  ($1::date + 1)::timestamp AT TIME ZONE 'Europe/Madrid'
       ORDER BY station_id, time`, [day]),
    db.query<{ station_id: string; latitude: number; longitude: number; altitude: number | null }>(
      `SELECT s.station_id, s.latitude, s.longitude, ${altitude} AS altitude FROM stations s`),
    db.query<{ end_ms: string }>(
      `SELECT (extract(epoch FROM ($1::date + 1)::timestamp AT TIME ZONE 'Europe/Madrid') * 1000)::bigint AS end_ms`, [day]),
  ]);
  const where = new Map(meta.rows.map((m) => [m.station_id, m]));
  const byId = new Map<string, HealthStation>();
  for (const r of rows.rows) {
    const m = where.get(r.station_id);
    if (!m || !Number.isFinite(Number(m.latitude)) || !Number.isFinite(Number(m.longitude))) continue;
    let st = byId.get(r.station_id);
    if (!st) {
      const alt = m.altitude == null ? null : Number(m.altitude);
      st = { id: r.station_id, lat: Number(m.latitude), lon: Number(m.longitude), alt: Number.isFinite(alt) ? alt : null, rows: [] };
      byId.set(r.station_id, st);
    }
    st.rows.push({
      t: Number(r.t), temperature: r.temperature, humidity: r.humidity, windSpeed: r.wind_speed, windGust: r.wind_gust,
      pressure: r.pressure, precip: r.precip, solar: r.solar_rad,
    });
  }
  return { stations: [...byId.values()], endMs: Number(end.rows[0].end_ms) };
}

/**
 * Night means (00-06 h, Madrid) of every station for the night of `day` and the nights before,
 * from the hourly aggregate: one light query (~15.000 rows), not the raw readings.
 * A night counts with 4 hours or more.
 */
async function loadNightMeans(day: string): Promise<NightMean[]> {
  const r = await getPool().query<{ station_id: string; night: string; wind: number | null; temp: number | null }>(`
    SELECT station_id, to_char((bucket AT TIME ZONE 'Europe/Madrid')::date, 'YYYY-MM-DD') AS night,
           avg(avg_wind) AS wind, avg(avg_temp) AS temp
      FROM readings_hourly
     WHERE bucket >= (($1::date - $2::int)::timestamp AT TIME ZONE 'Europe/Madrid')
       AND bucket <  (($1::date)::timestamp + interval '6 hours') AT TIME ZONE 'Europe/Madrid'
       AND extract(hour FROM bucket AT TIME ZONE 'Europe/Madrid') < 6
     GROUP BY 1, 2
    HAVING count(*) >= 4`, [day, CP_BASE_NIGHTS + 2]);
  return r.rows.map((x) => ({
    stationId: x.station_id,
    night: x.night,
    wind: x.wind == null ? null : Number(x.wind),
    temp: x.temp == null ? null : Number(x.temp),
  }));
}

/** «Cambio brusco» for the night of `day`; a failure here never stops the other rules. */
async function changePointsFor(day: string, stations: HealthStation[]): Promise<DetectedStrike[]> {
  try {
    const strikes = changePointStrikes(
      stations.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, alt: s.alt ?? null })),
      await loadNightMeans(day),
      day,
    );
    for (const s of strikes) log.info(`[Salud] cambio brusco ${day}: ${s.stationId} (${s.variable}) — ${s.detail}`);
    return strikes;
  } catch (err) {
    log.warn(`[Salud] cambio brusco ${day}: no se pudo calcular (${(err as Error).message})`);
    return [];
  }
}

async function saveDay(day: string, strikes: DetectedStrike[], stations: number): Promise<void> {
  const db = getPool();
  for (let i = 0; i < strikes.length; i += INSERT_CHUNK) {
    const chunk = strikes.slice(i, i + INSERT_CHUNK);
    const params: unknown[] = [];
    const rows = chunk.map((s, j) => {
      params.push(s.day, s.stationId, s.variable, s.rule, s.detail);
      const o = j * 5;
      return `($${o + 1}::date, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5})`;
    });
    await db.query(
      `INSERT INTO station_health_strikes (day, station_id, variable, rule, detail) VALUES ${rows.join(', ')} ON CONFLICT DO NOTHING`,
      params,
    );
  }
  await db.query(
    'INSERT INTO station_health_days (day, stations, strikes) VALUES ($1::date, $2, $3) ON CONFLICT (day) DO NOTHING',
    [day, stations, strikes.length],
  );
}

async function judge(nowMs: number): Promise<HealthVerdict[]> {
  const r = await getPool().query<{ d: string; station_id: string; variable: string; rule: string }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS d, station_id, variable, rule
       FROM station_health_strikes WHERE day >= CURRENT_DATE - $1::int`,
    [HEALTH_WINDOW_DAYS + 2],
  );
  return judgeHealth(
    r.rows.map((x) => ({ day: x.d, stationId: x.station_id, variable: x.variable as HealthVariable, rule: x.rule })),
    madridDay(nowMs),
  );
}

function report(verdicts: HealthVerdict[]): void {
  log.info(shadowSummary(verdicts));
  const now = outKeys(verdicts);
  if (lastOut) {
    const entered = [...now].filter((k) => !lastOut!.has(k));
    const left = [...lastOut].filter((k) => !now.has(k));
    if (entered.length) log.warn(`[Salud] en sombra, entrarian fuera: ${entered.join(', ')}`);
    if (left.length) log.info(`[Salud] en sombra, volverian: ${left.join(', ')}`);
  }
  lastOut = now;
}

function failed(err: unknown): void {
  const msg = (err as Error).message;
  if (/station_health_(strikes|days)/.test(msg) && /does not exist/.test(msg)) {
    disabled = true;
    log.warn('[Salud] faltan las tablas station_health_*: aplicar ingestor/schema.sql en la base; el juicio queda parado hasta el proximo reinicio');
  } else {
    log.warn(`[Salud] fallo: ${msg}`);
  }
}

/** At start: say in the log what the stored failures would take out. */
export async function loadStationHealth(nowMs = Date.now()): Promise<void> {
  try {
    report(await judge(nowMs));
  } catch (err) {
    failed(err);
  }
}

/** Hourly check; judges the pending days only in the small hours. Never throws. */
export async function runStationHealthCycle(nowMs = Date.now()): Promise<void> {
  const hour = madridHour(nowMs);
  if (running || disabled || hour < HEALTH_SLOT[0] || hour >= HEALTH_SLOT[1]) return;
  running = true;
  try {
    const pending = daysToJudge(await doneDays(), madridDay(nowMs));
    for (const day of pending.slice(0, MAX_DAYS_PER_RUN)) {
      const { stations, endMs } = await loadDay(day);
      const strikes = [...detectStrikes(stations, day, endMs), ...(await changePointsFor(day, stations))];
      await saveDay(day, strikes, stations.length);
      log.info(`[Salud] ${day}: ${strikes.length} fallos en ${new Set(strikes.map((s) => s.stationId)).size} de ${stations.length} estaciones`);
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
    if (pending.length > 0) report(await judge(nowMs));
  } catch (err) {
    failed(err);
  } finally {
    running = false;
  }
}
