/**
 * Rain watcher of the BETA weather points, a dated test (UserSpot.watchUntil).
 *
 * Every 10 min it compares the nearby gauges with what the WRF said BEFORE each hour, leaves the
 * sentence for the point's card (beta_signals, kind 'point-rain') and sends the changes to Telegram.
 * MeteoSIX only serves the current run from the next hour on, so the forecast is stored here as it is
 * issued (forecast_archive, sector 'meteo:<point>'): that is also the data to judge the test with and
 * to build a small rain model from.
 */
import { METEO_POINTS, type UserSpot } from '../src/config/userSpots.js';
import { pointRainPanorama, type ModelHour, type PanoramaState, type WatchGauge } from '../src/services/pointRainWatch.js';
import { describeBands, localHour, summarizeDays } from '../src/services/pointForecast.js';
import type { HourlyForecast } from '../src/types/forecast.js';
import { buildArchiveRows, writeArchiveRows } from './forecastArchive.js';
import { fetchWrfForecast, isMeteoSixConfigured } from './meteoSixFetcher.js';
import { dispatchPointRainBeta } from './alertDispatcher.js';
import { getPool } from './db.js';
import { log } from './logger.js';

export const POINT_WATCH_EVERY_MS = 10 * 60_000;
const ARCHIVE_EVERY_MS = 3 * 3_600_000;
const ARCHIVE_RETRY_MS = 30 * 60_000;
const HISTORY_H = 8;
const AHEAD_H = 14;
/** Telegram only by day, and not more often than this. */
const SEND_FROM_H = 7;
const SEND_TO_H = 20;
const MIN_GAP_MS = 45 * 60_000;

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });

interface PointState {
  hours: HourlyForecast[];
  archivedAt: number;
  sent: Set<string>;
  lastSentAt: number;
  partDay: string;
  lastState: PanoramaState | null;
  loggedAt: number;
}

const states = new Map<string, PointState>();
const stateOf = (id: string): PointState => {
  let s = states.get(id);
  if (!s) {
    s = { hours: [], archivedAt: 0, sent: new Set(), lastSentAt: 0, partDay: '', lastState: null, loggedAt: 0 };
    states.set(id, s);
  }
  return s;
};

async function archiveForecast(p: UserSpot, archiveId: string, st: PointState, nowMs: number): Promise<void> {
  if (!isMeteoSixConfigured() || nowMs - st.archivedAt < ARCHIVE_EVERY_MS) return;
  try {
    const hours = await fetchWrfForecast(p.center[1], p.center[0]);
    if (hours.length === 0) throw new Error('sin horas');
    const rows = await writeArchiveRows(buildArchiveRows(archiveId, 'wrf', new Date(nowMs), hours));
    st.hours = hours;
    st.archivedAt = nowMs;
    log.info(`[Avisador lluvia] ${p.name}: ${rows} horas de WRF guardadas`);
  } catch (err) {
    st.archivedAt = nowMs - ARCHIVE_EVERY_MS + ARCHIVE_RETRY_MS;
    log.warn(`[Avisador lluvia] ${p.name}: sin WRF (${(err as Error).message})`);
  }
}

/** For each hour, what the model said before it: the newest issue that was out by then. */
async function loadModel(archiveId: string, nowMs: number): Promise<ModelHour[]> {
  const r = await getPool().query<{ valid_time: Date; precip_mm: number | null }>(
    `SELECT DISTINCT ON (valid_time) valid_time, precip_mm FROM forecast_archive
      WHERE sector = $1 AND valid_time >= $2 AND valid_time <= $3 AND issued_at <= valid_time
      ORDER BY valid_time, issued_at DESC`,
    [archiveId, new Date(nowMs - HISTORY_H * 3_600_000), new Date(nowMs + AHEAD_H * 3_600_000)],
  );
  return r.rows.map((x) => ({ timeMs: new Date(x.valid_time).getTime(), mm: x.precip_mm == null ? null : Number(x.precip_mm) }));
}

async function loadGauges(p: UserSpot, nowMs: number): Promise<WatchGauge[]> {
  const list = p.gauges ?? [];
  const r = await getPool().query<{ station_id: string; time: Date; precip: number }>(
    `SELECT station_id, time, precip FROM readings
      WHERE time > $1 AND precip IS NOT NULL AND station_id = ANY($2::text[])
      ORDER BY station_id, time`,
    [new Date(nowMs - HISTORY_H * 3_600_000), list.map((g) => g.id)],
  );
  return list.map((g) => ({
    id: g.id,
    name: g.name,
    samples: r.rows.filter((x) => x.station_id === g.id).map((x) => ({ t: new Date(x.time).getTime(), mm: Number(x.precip) })),
  }));
}

async function saveStatus(pointId: string, state: PanoramaState, text: string): Promise<void> {
  await getPool().query(
    `INSERT INTO beta_signals (kind, spot_id, time, active, reason) VALUES ('point-rain', $1, NOW(), TRUE, $2)
     ON CONFLICT (kind, spot_id) DO UPDATE SET time = EXCLUDED.time, active = EXCLUDED.active, reason = EXCLUDED.reason`,
    [pointId, `${state}|${text}`],
  );
}

async function send(p: UserSpot, key: string, line: string): Promise<boolean> {
  const message = `*BETA · ${p.name}* (prueba, solo te llega a ti)\n${line}`;
  return dispatchPointRainBeta(`point-rain:${p.id}:${key}`, `BETA ${p.name}`, message);
}

async function watchPoint(p: UserSpot, nowMs: number): Promise<void> {
  const archiveId = `meteo:${p.id.replace(/^meteo-/, '')}`;
  const st = stateOf(p.id);
  await archiveForecast(p, archiveId, st, nowMs);

  const [model, gauges] = await Promise.all([loadModel(archiveId, nowMs), loadGauges(p, nowMs)]);
  const panorama = pointRainPanorama({ model, gauges, nowMs });
  await saveStatus(p.id, panorama.state, panorama.text);

  if (panorama.state !== st.lastState || nowMs - st.loggedAt >= 3_600_000) {
    log.info(`[Avisador lluvia] ${p.name}: ${panorama.state} (${model.length} h de modelo). ${panorama.text}`);
    st.lastState = panorama.state;
    st.loggedAt = nowMs;
  }

  const hour = localHour(new Date(nowMs));
  if (hour < SEND_FROM_H || hour > SEND_TO_H) return;

  const today = dayFmt.format(new Date(nowMs));
  if (hour === SEND_FROM_H && st.partDay !== today && st.hours.length > 0) {
    const day = summarizeDays(st.hours, new Date(nowMs), 1)[0];
    if (day && await send(p, `parte:${today}`, `Hoy según el WRF: ${describeBands(day.bands)}.`)) st.partDay = today;
  }

  if (!panorama.key || st.sent.has(panorama.key) || nowMs - st.lastSentAt < MIN_GAP_MS) return;
  if (await send(p, panorama.key, panorama.text)) {
    st.sent.add(panorama.key);
    st.lastSentAt = nowMs;
  }
}

let running = false;

/** Fire-and-forget from index.ts. Never throws; past its date a point simply stops. */
export async function runPointRainWatch(nowMs = Date.now()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const today = dayFmt.format(new Date(nowMs));
    for (const p of METEO_POINTS) {
      if (!p.gauges?.length || !p.watchUntil || today > p.watchUntil) continue;
      try {
        await watchPoint(p, nowMs);
      } catch (err) {
        log.warn(`[Avisador lluvia] ${p.name}: ciclo fallido (${(err as Error).message})`);
      }
    }
  } finally {
    running = false;
  }
}
