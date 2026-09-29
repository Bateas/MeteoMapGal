/**
 * Strong-wind SAFETY alert — the counterpart the spot alert never had.
 *
 * The spot alert announces a spot rising into a sailable verdict: an invitation. On 29-sep a
 * front brought 27-36 kt means and 35-46 kt gusts at the exposed stations and buoys of the Rías
 * from dawn, and Telegram said nothing about it, because nothing in the pipeline was ever meant
 * to. This is that message.
 *
 * It fires on MEASURED gusts, never on a model, and never on one instrument: at least two
 * sources near a spot must agree. Each source passes a physical plausibility check first, so a
 * cup anemometer that reports a 39 kt gust inside a 4 kt mean (wu_IMARN3, same morning) cannot
 * start it. Mountain stations are left out: the sailor is at sea level.
 *
 * Thresholds from 90 days of hourly maxima, daytime hours, two or more sources within 10 km of
 * a spot: gusts of 30 kt happened on 9 days (strong nortada afternoons, too common to be news),
 * 35 kt on 3 days, 40 kt only on the front of 29-sep.
 */
import { haversineDistance } from '../src/services/geoUtils.js';
import { isWindBlacklisted } from '../src/services/spotScoringEngine.js';
import type { BuoyWind, StationReading } from './analyzerLogic.js';

export type WindSafetyLevel = 'aviso' | 'peligro';
export type WindSector = 'rias' | 'embalse';

export const WIND_AVISO_GUST_KT = 35;
export const WIND_PELIGRO_GUST_KT = 40;
/** Two independent sources, never one (the project's rule for every alert). */
export const WIND_MIN_SOURCES = 2;
/** A source counts only if some spot of the sector is within this distance of it. */
export const WIND_NEAR_SPOT_KM = 10;
/** A gust that strong inside a weaker mean is a spike, not a gale. */
export const WIND_MIN_MEAN_KT = 12;
export const WIND_MAX_GUST_RATIO = 3;
export const WIND_MAX_GUST_KT = 90; // the same ceiling as the engines (MAX_PLAUSIBLE_GUST_KT)
export const WIND_MAX_AGE_MIN = 90;
/** Above this a station measures the mountain, not the water. Unknown altitude: left out. */
export const WIND_MAX_ALTITUDE_M: Record<WindSector, number> = { rias: 150, embalse: 250 };
/** Without a qualifying reading for this long, the episode is over and a new one alerts again. */
export const WIND_EPISODE_GAP_MS = 2 * 60 * 60_000;

const MS_TO_KT = 1.94384;

export interface SafetySpot { id: string; name: string; lat: number; lon: number; sector: WindSector }

export interface WindEvidence { name: string; meanKt: number; gustKt: number; lat: number; lon: number }

export interface WindSafetyAssessment {
  sector: WindSector;
  level: WindSafetyLevel | null;
  /** Every source that passed the checks with a gust at or above the aviso threshold, strongest first. */
  evidence: WindEvidence[];
  /** Spots within WIND_NEAR_SPOT_KM of that evidence, without naming the same place twice. */
  spots: string[];
}

function fresh(time: string | Date | undefined, nowMs: number): boolean {
  if (time == null) return true;
  const t = new Date(time).getTime();
  return Number.isFinite(t) && nowMs - t <= WIND_MAX_AGE_MIN * 60_000;
}

function plausible(meanKt: number, gustKt: number): boolean {
  return meanKt >= WIND_MIN_MEAN_KT && gustKt <= WIND_MAX_GUST_RATIO * meanKt && gustKt <= WIND_MAX_GUST_KT;
}

function nearSpot(spots: SafetySpot[], lat: number, lon: number): boolean {
  return spots.some((s) => haversineDistance(s.lat, s.lon, lat, lon) <= WIND_NEAR_SPOT_KM);
}

export function assessStrongWind(
  spots: SafetySpot[],
  readings: StationReading[],
  buoys: BuoyWind[],
  nowMs: number,
): WindSafetyAssessment[] {
  const out: WindSafetyAssessment[] = [];
  for (const sector of ['rias', 'embalse'] as const) {
    const sectorSpots = spots.filter((s) => s.sector === sector);
    if (sectorSpots.length === 0) continue;
    const evidence: WindEvidence[] = [];

    for (const r of readings) {
      if (r.wind_speed == null || r.wind_gust == null) continue;
      if (r.altitude == null || r.altitude > WIND_MAX_ALTITUDE_M[sector]) continue;
      if (!r.latitude || !r.longitude || isWindBlacklisted(r.station_id)) continue;
      if (!fresh(r.time, nowMs) || !nearSpot(sectorSpots, r.latitude, r.longitude)) continue;
      const meanKt = r.wind_speed * MS_TO_KT;
      const gustKt = r.wind_gust * MS_TO_KT;
      if (gustKt < WIND_AVISO_GUST_KT || !plausible(meanKt, gustKt)) continue;
      evidence.push({ name: r.name ?? r.station_id, meanKt, gustKt, lat: r.latitude, lon: r.longitude });
    }

    for (const b of buoys) {
      if (b.wind_gust == null || !b.lat || !b.lon) continue;
      if (!fresh(b.time, nowMs) || !nearSpot(sectorSpots, b.lat, b.lon)) continue;
      const meanKt = b.wind_speed * MS_TO_KT;
      const gustKt = b.wind_gust * MS_TO_KT;
      if (gustKt < WIND_AVISO_GUST_KT || !plausible(meanKt, gustKt)) continue;
      evidence.push({ name: `Boya ${b.station_name ?? b.station_id}`, meanKt, gustKt, lat: b.lat, lon: b.lon });
    }

    evidence.sort((a, b) => b.gustKt - a.gustKt);
    const strong = evidence.filter((e) => e.gustKt >= WIND_PELIGRO_GUST_KT).length;
    const level: WindSafetyLevel | null = strong >= WIND_MIN_SOURCES ? 'peligro'
      : evidence.length >= WIND_MIN_SOURCES ? 'aviso' : null;

    // Spots ordered by the strongest gust measured near them, so the message names the most
    // exposed first. In config order, the first alert on 29-sep listed five spots of the inner
    // ría and cut A Lanzada and Cíes, where the 44-46 kt gusts were.
    const ranked = sectorSpots
      .map((s) => ({ s, peak: Math.max(0, ...evidence
        .filter((e) => haversineDistance(s.lat, s.lon, e.lat, e.lon) <= WIND_NEAR_SPOT_KM)
        .map((e) => e.gustKt)) }))
      .filter((x) => x.peak > 0)
      .sort((a, b) => b.peak - a.peak);
    const named: SafetySpot[] = [];
    for (const { s } of ranked) {
      if (named.some((n) => haversineDistance(n.lat, n.lon, s.lat, s.lon) <= 2)) continue; // A Lanzada and its surf twin
      named.push(s);
    }
    out.push({ sector, level, evidence, spots: named.map((s) => s.name) });
  }
  return out;
}

export interface WindEpisode { sentLevel: WindSafetyLevel | null; lastActiveMs: number }

const RANK: Record<WindSafetyLevel, number> = { aviso: 1, peligro: 2 };

/**
 * One message per episode, plus one more if it escalates to peligro. The caller records
 * `sentLevel` only after a successful send, so an episode that starts at night is announced
 * on the first cycle after the night silence, if it is still going on.
 */
export function windAlertDue(prev: WindEpisode | undefined, level: WindSafetyLevel | null, nowMs: number): { due: boolean; episode: WindEpisode | undefined } {
  const over = !prev || nowMs - prev.lastActiveMs > WIND_EPISODE_GAP_MS;
  if (!level) return { due: false, episode: over ? undefined : prev };
  const episode: WindEpisode = { sentLevel: over ? null : prev!.sentLevel, lastActiveMs: nowMs };
  const due = episode.sentLevel == null || RANK[level] > RANK[episode.sentLevel];
  return { due, episode };
}

/** Episodes still open after a restart, from the stored sends (`wind:<sector>` keys). A send older
 *  than the episode gap closed its episode already, and a new one is announced as usual. */
export function episodesFromSends(sends: { key: string; atMs: number; level: string }[], nowMs: number): Map<string, WindEpisode> {
  const out = new Map<string, WindEpisode>();
  for (const s of sends) {
    if (!s.key.startsWith('wind:') || (s.level !== 'aviso' && s.level !== 'peligro')) continue;
    if (nowMs - s.atMs > WIND_EPISODE_GAP_MS) continue;
    const sector = s.key.slice(5);
    const cur = out.get(sector);
    if (!cur || cur.lastActiveMs < s.atMs) out.set(sector, { sentLevel: s.level, lastActiveMs: s.atMs });
  }
  return out;
}

/** How far back a send can still belong to an episode that the readings show never ended. */
export const WIND_REOPEN_MAX_MS = 24 * 60 * 60_000;
/** Step of the replay over past readings in reopenFromHistory. */
export const WIND_REPLAY_STEP_MS = 10 * 60_000;

function timeMs(t: string | Date | undefined): number {
  return t == null ? NaN : new Date(t).getTime();
}

/** The latest row of each station/buoy at or before `atMs`, from rows spanning some hours. */
function latestAt<T extends { time?: string | Date }>(rows: T[], idOf: (r: T) => string | number, atMs: number): T[] {
  const best = new Map<string | number, T>();
  for (const r of rows) {
    const t = timeMs(r.time);
    if (!(t <= atMs)) continue;
    const cur = best.get(idOf(r));
    if (!cur || timeMs(cur.time) < t) best.set(idOf(r), r);
  }
  return [...best.values()];
}

/**
 * Reopen, after a restart, a strong-wind episode whose last SEND is older than the gap but that
 * the readings show still going. episodesFromSends alone closed it: on 29-sep the gale was
 * announced at 12:06 and blew on all afternoon, so the deploy of 16:41 found a send four hours
 * old and would announce the same gale again. The episode is really closed only when the wind
 * stopped for the whole gap, and that is in the readings: the check is replayed every
 * WIND_REPLAY_STEP_MS over the last gap, newest first, with the same rules as the live one.
 * `sends` are the stored sends; `readings`/`buoys` every row of the last gap plus the freshness
 * window (the replay picks, at each step, the latest row of each source at or before it).
 */
export function reopenFromHistory(
  sends: { key: string; atMs: number; level: string }[],
  already: ReadonlySet<string>,
  spots: SafetySpot[],
  readings: StationReading[],
  buoys: BuoyWind[],
  nowMs: number,
): Map<string, WindEpisode> {
  const out = new Map<string, WindEpisode>();
  const lastSent = new Map<string, { atMs: number; level: WindSafetyLevel }>();
  for (const s of sends) {
    if (!s.key.startsWith('wind:') || (s.level !== 'aviso' && s.level !== 'peligro')) continue;
    if (nowMs - s.atMs > WIND_REOPEN_MAX_MS) continue;
    const sector = s.key.slice(5);
    if (already.has(sector)) continue;
    const cur = lastSent.get(sector);
    if (!cur || cur.atMs < s.atMs) lastSent.set(sector, { atMs: s.atMs, level: s.level });
  }
  if (lastSent.size === 0) return out;
  for (let t = nowMs; t >= nowMs - WIND_EPISODE_GAP_MS && out.size < lastSent.size; t -= WIND_REPLAY_STEP_MS) {
    const assessed = assessStrongWind(spots, latestAt(readings, (r) => r.station_id, t), latestAt(buoys, (b) => b.station_id, t), t);
    for (const a of assessed) {
      const sent = lastSent.get(a.sector);
      if (!sent || out.has(a.sector) || !a.level || t < sent.atMs) continue;
      out.set(a.sector, { sentLevel: sent.level, lastActiveMs: t });
    }
  }
  return out;
}

/** How often the state line is repeated while nothing changes, as a heartbeat. */
export const WIND_LOG_HEARTBEAT_MS = 60 * 60_000;

/** The state that decides whether the log line is news: the level, or whether there is anything
 *  at all. The figures move every cycle, so logging on any change wrote the same line every five
 *  minutes through the whole front of 29-sep. */
export function windLogState(a: Pick<WindSafetyAssessment, 'level' | 'evidence'>): string {
  return a.level ?? (a.evidence.length > 0 ? 'sin corroborar' : 'sin rachas fuertes');
}

/** Log when the state changes, and once an hour while it holds with something to report. The
 *  first cycle after a start stays quiet when there is nothing: only changes are news. */
export function windLogDue(prev: { state: string; atMs: number } | undefined, state: string, nowMs: number): boolean {
  if (!prev) return state !== 'sin rachas fuertes';
  if (prev.state !== state) return true;
  return state !== 'sin rachas fuertes' && nowMs - prev.atMs >= WIND_LOG_HEARTBEAT_MS;
}

const SECTOR_LABEL: Record<WindSector, string> = { rias: 'Rías Baixas', embalse: 'Embalse' };

export function formatWindSafetyMessage(a: WindSafetyAssessment): { title: string; message: string } {
  const where = SECTOR_LABEL[a.sector];
  const title = a.level === 'peligro' ? `VIENTO MUY FUERTE — ${where}` : `Viento fuerte — ${where}`;
  const lines = a.evidence.slice(0, 5).map((e) => `${e.name}: rachas ${Math.round(e.gustKt)} kt (media ${Math.round(e.meanKt)})`);
  let message = `*${title}*\nMedido ahora:\n${lines.join('\n')}`;
  if (a.spots.length > 0) message += `\nCerca de: ${a.spots.slice(0, 5).join(', ')}`;
  if (a.level === 'peligro') message += '\nCondiciones peligrosas para embarcaciones ligeras.';
  return { title, message };
}
