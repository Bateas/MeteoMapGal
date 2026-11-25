/**
 * Wind trend detection — analyzes reading history to detect wind ramps.
 *
 * A "wind ramp" is when wind speed increases significantly over a short period.
 * This is a strong signal that conditions are changing — either a thermal
 * establishing or a front arriving.
 *
 * Used by spot scoring to:
 * 1. Detect "wind building" before it reaches sailing thresholds
 * 2. Trigger alerts for sudden wind changes
 *
 * Pure computation — no API calls or side effects.
 */

import type { NormalizedReading } from '../types/station';
import { msToKnots } from './windUtils';

export interface WindTrend {
  /** Change in wind speed over the analysis window (kt) — positive = building */
  deltaKt: number;
  /** Rate of change (kt per hour) */
  rateKtPerHour: number;
  /** Current speed (kt) */
  currentKt: number;
  /** Speed at the start of the window (kt) */
  startKt: number;
  /** Minutes the change was measured over (shown as is: never stretched to a fixed window) */
  minutes: number;
  /** Stations behind it (1 for a single station; for a spot, those moving together) */
  stations: number;
  /** Direction trend: 'stable', 'veering' (clockwise), 'backing' (counter-clockwise) */
  dirTrend: 'stable' | 'veering' | 'backing';
  /** Human-readable summary */
  label: string;
  /** Signal strength: 'none' | 'building' | 'rapid' | 'dropping' */
  signal: 'none' | 'building' | 'rapid' | 'dropping';
}

/** Minimum readings needed for trend analysis */
const MIN_READINGS = 3;
/** Analysis window (ms) — look at last 30 minutes */
const WINDOW_MS = 30 * 60 * 1000;
/** Threshold for "building" signal (kt over window) */
const BUILDING_THRESHOLD_KT = 3;
/** Threshold for "rapid" signal (kt over window) */
const RAPID_THRESHOLD_KT = 6;
/** Threshold for direction change to be considered veering/backing (degrees) */
const DIR_CHANGE_THRESHOLD = 30;

/**
 * Analyze wind trend from a station's reading history.
 * Returns null if insufficient data.
 */
export function analyzeWindTrend(
  history: NormalizedReading[],
  currentReading?: NormalizedReading,
): WindTrend | null {
  if (!history || history.length < MIN_READINGS) return null;

  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  // Filter to readings within the analysis window, sorted by time
  const recent = history
    .filter((r) => r.windSpeed !== null && r.timestamp.getTime() >= windowStart)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Add current reading if provided and not already in history
  if (currentReading?.windSpeed !== null && currentReading) {
    const alreadyIn = recent.some(
      (r) => Math.abs(r.timestamp.getTime() - currentReading.timestamp.getTime()) < 60_000,
    );
    if (!alreadyIn) recent.push(currentReading);
  }

  if (recent.length < MIN_READINGS) return null;

  const first = recent[0];
  const last = recent[recent.length - 1];
  const startKt = msToKnots(first.windSpeed!);
  const currentKt = msToKnots(last.windSpeed!);
  const deltaKt = currentKt - startKt;
  const durationHours = (last.timestamp.getTime() - first.timestamp.getTime()) / 3_600_000;
  const rateKtPerHour = durationHours > 0 ? deltaKt / durationHours : 0;

  // Direction trend (if direction data available)
  let dirTrend: 'stable' | 'veering' | 'backing' = 'stable';
  const dirsWithData = recent.filter((r) => r.windDirection !== null);
  if (dirsWithData.length >= 2) {
    const firstDir = dirsWithData[0].windDirection!;
    const lastDir = dirsWithData[dirsWithData.length - 1].windDirection!;
    // Shortest angular difference with sign
    const diff = ((lastDir - firstDir + 540) % 360) - 180;
    if (Math.abs(diff) > DIR_CHANGE_THRESHOLD) {
      dirTrend = diff > 0 ? 'veering' : 'backing';
    }
  }

  // Classify signal
  let signal: WindTrend['signal'] = 'none';
  if (deltaKt >= RAPID_THRESHOLD_KT) signal = 'rapid';
  else if (deltaKt >= BUILDING_THRESHOLD_KT) signal = 'building';
  else if (deltaKt <= -BUILDING_THRESHOLD_KT) signal = 'dropping';

  // Build label
  let label = '';
  if (signal === 'rapid') {
    label = `Subida rápida +${deltaKt.toFixed(0)}kt en ${Math.round(durationHours * 60)}min`;
  } else if (signal === 'building') {
    label = `Viento subiendo +${deltaKt.toFixed(0)}kt`;
  } else if (signal === 'dropping') {
    label = `Viento bajando ${deltaKt.toFixed(0)}kt`;
  }

  const minutes = Math.round(durationHours * 60);
  return { deltaKt, rateKtPerHour, currentKt, startKt, minutes, stations: 1, dirTrend, label, signal };
}

/** A station the spot is scored with, for the spot's trend. */
export interface TrendStation {
  id: string;
  distKm: number;
  /** One of the spot's own stations (`preferredStations`): counts at any distance. */
  preferred: boolean;
}

/** Stations moving the same way, at least, for a spot to show a trend. */
export const SPOT_TREND_MIN_STATIONS = 2;

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * The trend of a spot: what its NEAR stations do together. Only stations within
 * `nearKm` (or the spot's own preferred ones) count, never one whose wind is excluded,
 * and at least two must move the same way; the figure is their median, measured over
 * their own window, never a rate stretched to 30 min.
 *
 * Before (1-oct, Cesantes at 12:03): the strongest trend of ANY station in its 12 km
 * circle won. Two Wunderground stations at the edge — Moaña and Marín, the latter in
 * the Ría de Pontevedra — went 1.9 → 5.8 kt, and the card read «Viento 4 kt» next to
 * «+7kt/30min subiendo» while the water was a mirror and every station within 6 km
 * read 0-2 kt.
 */
export function analyzeSpotWindTrend(
  stations: readonly TrendStation[],
  readingHistory: Map<string, NormalizedReading[]>,
  currentReadings: Map<string, NormalizedReading>,
  nearKm: number,
  isExcluded: (stationId: string) => boolean = () => false,
): WindTrend | null {
  const ups: WindTrend[] = [];
  const downs: WindTrend[] = [];
  for (const st of stations) {
    if (isExcluded(st.id)) continue;
    if (!st.preferred && st.distKm > nearKm) continue;
    const history = readingHistory.get(st.id);
    if (!history) continue;
    const trend = analyzeWindTrend(history, currentReadings.get(st.id));
    if (!trend || trend.signal === 'none') continue;
    (trend.signal === 'dropping' ? downs : ups).push(trend);
  }

  const group = ups.length >= SPOT_TREND_MIN_STATIONS && ups.length > downs.length ? ups
    : downs.length >= SPOT_TREND_MIN_STATIONS && downs.length > ups.length ? downs
    : null;
  if (!group) return null;

  const deltaKt = medianOf(group.map((t) => t.deltaKt));
  const minutes = Math.max(1, Math.round(medianOf(group.map((t) => t.minutes))));
  const signal: WindTrend['signal'] = deltaKt >= RAPID_THRESHOLD_KT ? 'rapid'
    : deltaKt >= BUILDING_THRESHOLD_KT ? 'building'
    : deltaKt <= -BUILDING_THRESHOLD_KT ? 'dropping'
    : 'none';
  if (signal === 'none') return null;
  // The station closest to the median speaks for the direction trend.
  const typical = [...group].sort((a, b) => Math.abs(a.deltaKt - deltaKt) - Math.abs(b.deltaKt - deltaKt))[0];
  const kt = Math.round(Math.abs(deltaKt));
  const label = signal === 'dropping'
    ? `Viento bajando ${kt}kt en ${minutes} min`
    : `${signal === 'rapid' ? 'Subida rápida' : 'Viento subiendo'} +${kt}kt en ${minutes} min`;
  return {
    deltaKt,
    rateKtPerHour: medianOf(group.map((t) => t.rateKtPerHour)),
    currentKt: medianOf(group.map((t) => t.currentKt)),
    startKt: medianOf(group.map((t) => t.startKt)),
    minutes,
    stations: group.length,
    dirTrend: typical.dirTrend,
    label,
    signal,
  };
}

/** The conclusion someone wants from a run of wind figures, without doing the sum. */
export type WindDrift = 'sube' | 'baja' | 'estable';

export interface WindPoint {
  t: number;
  kt: number;
}

const DRIFT_RECENT_MS = 45 * 60_000;
/** Recent plus before fit the two hours the spots keep (WIND_HISTORY_MAX_AGE_MS). */
const DRIFT_BEFORE_MS = 75 * 60_000;
const DRIFT_MIN_POINTS = 2;
const DRIFT_MIN_KT = 2;
/** At 30 kt a change of 2 is noise. */
const DRIFT_MIN_SHARE = 0.15;
/** Going from nothing to almost nothing is still calm. */
const DRIFT_CALM_KT = 3;

const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Compares means, not the two ends of the run, so one gust does not turn into «sube». Says nothing with too few
 * readings at either side, which leaves out a station that reports hourly: better silent than wrong.
 */
export function windDrift(points: readonly WindPoint[], now: number = Date.now()): WindDrift | null {
  const recent: number[] = [];
  const before: number[] = [];
  for (const p of points) {
    const age = now - p.t;
    if (age < 0 || !Number.isFinite(p.kt)) continue;
    if (age <= DRIFT_RECENT_MS) recent.push(p.kt);
    else if (age <= DRIFT_RECENT_MS + DRIFT_BEFORE_MS) before.push(p.kt);
  }
  if (recent.length < DRIFT_MIN_POINTS || before.length < DRIFT_MIN_POINTS) return null;

  const now_ = meanOf(recent);
  const then = meanOf(before);
  if (now_ < DRIFT_CALM_KT && then < DRIFT_CALM_KT) return 'estable';
  const diff = now_ - then;
  const needed = Math.max(DRIFT_MIN_KT, then * DRIFT_MIN_SHARE);
  if (diff >= needed) return 'sube';
  if (diff <= -needed) return 'baja';
  return 'estable';
}

/** Past this a trend is about a wind long gone: no word about it, whatever the readings said. */
export const TREND_MAX_AGE_MIN = 90;

/**
 * For a spot: its stations moving together win (analyzeSpotWindTrend); otherwise the run of figures the card
 * itself has shown, which can never contradict the number beside it.
 */
export function spotWindDrift(
  trend: WindTrend | null | undefined,
  points: readonly WindPoint[],
  now: number = Date.now(),
): WindDrift | null {
  if (trend?.signal === 'dropping') return 'baja';
  if (trend?.signal === 'building' || trend?.signal === 'rapid') return 'sube';
  return windDrift(points, now);
}
