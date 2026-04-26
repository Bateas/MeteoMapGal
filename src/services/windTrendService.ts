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

  return { deltaKt, rateKtPerHour, currentKt, startKt, dirTrend, label, signal };
}

/**
 * Analyze trends for all stations near a spot.
 * Returns the strongest trend signal from any station.
 */
export function analyzeSpotWindTrend(
  stationIds: string[],
  readingHistory: Map<string, NormalizedReading[]>,
  currentReadings: Map<string, NormalizedReading>,
): WindTrend | null {
  let strongest: WindTrend | null = null;

  for (const id of stationIds) {
    const history = readingHistory.get(id);
    if (!history) continue;
    const current = currentReadings.get(id);
    const trend = analyzeWindTrend(history, current);
    if (!trend || trend.signal === 'none') continue;

    if (!strongest || Math.abs(trend.deltaKt) > Math.abs(strongest.deltaKt)) {
      strongest = trend;
    }
  }

  return strongest;
}
