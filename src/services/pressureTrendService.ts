/**
 * Barometric Pressure Trend Service
 *
 * Detects rapid pressure drops across station network as early storm indicators.
 * A drop of ≥3 hPa in 3 hours is a significant meteorological event ("bomba
 * barométrica" threshold in Galicia). Even 2 hPa/3h is noteworthy.
 *
 * Uses reading history from weatherStore to compute per-station trends,
 * then aggregates across the network for consensus.
 */

import type { NormalizedReading } from '../types/station';
import type { UnifiedAlert } from './alertService';

// ── Config ──────────────────────────────────────────

/** Lookback window for trend calculation (ms) */
const TREND_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 hours

/** Minimum number of stations with pressure data to emit an alert */
const MIN_STATIONS = 2;

/** Maximum age of the latest reading to consider a station "active" (ms) */
const MAX_READING_AGE_MS = 30 * 60 * 1000; // 30 min

// ── Thresholds (hPa drop in 3h) ────────────────────

const THRESHOLDS = {
  /** ≥4 hPa/3h — rapid deepening, storm approaching */
  critical: -4,
  /** ≥3 hPa/3h — significant drop */
  high: -3,
  /** ≥2 hPa/3h — moderate drop, worth noting */
  moderate: -2,
};

// ── Types ───────────────────────────────────────────

export interface PressureTrend {
  /** Station ID */
  stationId: string;
  /** Pressure change in hPa over the window (negative = dropping) */
  deltaHPa: number;
  /** Current pressure (hPa) */
  currentPressure: number;
  /** Oldest pressure used in comparison (hPa) */
  oldestPressure: number;
  /** Time span of the comparison (ms) */
  timeSpanMs: number;
}

export interface PressureTrendResult {
  /** Per-station trends (only stations with enough data) */
  trends: PressureTrend[];
  /** Network median pressure change (hPa) */
  medianDelta: number;
  /** Number of stations showing a drop ≥2 hPa */
  droppingCount: number;
  /** Total stations analyzed */
  totalAnalyzed: number;
}

// ── Core logic ──────────────────────────────────────

/**
 * Compute pressure trend for each station that has history with pressure data.
 */
export function computePressureTrends(
  currentReadings: Map<string, NormalizedReading>,
  readingHistory: Map<string, NormalizedReading[]>,
): PressureTrendResult {
  const now = Date.now();
  const windowStart = now - TREND_WINDOW_MS;
  const trends: PressureTrend[] = [];

  for (const [stationId, history] of readingHistory) {
    const current = currentReadings.get(stationId);
    if (!current?.pressure) continue;
    if (now - current.timestamp.getTime() > MAX_READING_AGE_MS) continue;

    // Find the oldest reading within the window that has pressure
    const windowReadings = history.filter(
      (r) => r.pressure != null && r.timestamp.getTime() >= windowStart
    );

    if (windowReadings.length < 2) continue;

    // Sort by timestamp ascending
    windowReadings.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const oldest = windowReadings[0];
    if (!oldest.pressure) continue;

    // Require at least 30 min of time span to avoid noise
    const timeSpanMs = current.timestamp.getTime() - oldest.timestamp.getTime();
    if (timeSpanMs < 30 * 60 * 1000) continue;

    const deltaHPa = current.pressure - oldest.pressure;

    trends.push({
      stationId,
      deltaHPa,
      currentPressure: current.pressure,
      oldestPressure: oldest.pressure,
      timeSpanMs,
    });
  }

  // Compute network statistics
  const deltas = trends.map((t) => t.deltaHPa).sort((a, b) => a - b);
  const medianDelta = deltas.length > 0
    ? deltas[Math.floor(deltas.length / 2)]
    : 0;
  const droppingCount = trends.filter((t) => t.deltaHPa <= THRESHOLDS.moderate).length;

  return { trends, medianDelta, droppingCount, totalAnalyzed: trends.length };
}

/**
 * Build unified alerts from pressure trend analysis.
 * Only emits alerts when multiple stations confirm the trend (consensus).
 */
export function buildPressureTrendAlerts(
  currentReadings: Map<string, NormalizedReading>,
  readingHistory: Map<string, NormalizedReading[]>,
): UnifiedAlert[] {
  const result = computePressureTrends(currentReadings, readingHistory);

  if (result.totalAnalyzed < MIN_STATIONS) return [];

  const { medianDelta, droppingCount, totalAnalyzed } = result;
  const alerts: UnifiedAlert[] = [];

  // Need at least 2 stations dropping to avoid single-station noise
  if (droppingCount < MIN_STATIONS) return [];

  const ratio = droppingCount / totalAnalyzed;
  const absMedian = Math.abs(medianDelta);

  // Determine severity from median drop
  let score: number;
  let title: string;
  let detail: string;

  if (medianDelta <= THRESHOLDS.critical) {
    // ≥4 hPa/3h — rapid deepening
    score = 75 + Math.min(15, (absMedian - 4) * 5); // 75-90
    title = 'Caída barométrica rápida';
    detail = `${absMedian.toFixed(1)} hPa en 3h — ${droppingCount}/${totalAnalyzed} estaciones confirman. Posible borrasca intensa.`;
  } else if (medianDelta <= THRESHOLDS.high) {
    // ≥3 hPa/3h
    score = 50 + Math.min(20, (absMedian - 3) * 10); // 50-70
    title = 'Presión en descenso';
    detail = `${absMedian.toFixed(1)} hPa en 3h — ${droppingCount}/${totalAnalyzed} estaciones. Posible cambio de tiempo.`;
  } else if (medianDelta <= THRESHOLDS.moderate && ratio >= 0.5) {
    // ≥2 hPa/3h and majority of stations agree
    score = 25 + Math.min(20, (absMedian - 2) * 10); // 25-45
    title = 'Tendencia barométrica';
    detail = `${absMedian.toFixed(1)} hPa en 3h — ${droppingCount} estaciones con descenso moderado.`;
  } else {
    return [];
  }

  alerts.push({
    id: 'pressure-trend',
    category: 'pressure',
    severity: score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'moderate' : 'info',
    score,
    icon: 'gauge',
    title,
    detail,
    urgent: score >= 75,
    updatedAt: new Date(),
  });

  return alerts;
}
