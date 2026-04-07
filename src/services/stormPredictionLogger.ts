/**
 * Storm Prediction Logger — stores prediction snapshots to localStorage
 * for future calibration and accuracy analysis.
 *
 * Every 5 minutes (when prediction > 0%), logs a snapshot with:
 * - All 8 signal values and weights
 * - Probability, horizon, severity
 * - Whether lightning was actually observed (ground truth)
 *
 * Data can later be extracted for:
 * - Signal weight calibration (which signals best predicted real storms?)
 * - False positive analysis (what combination triggered false alarms?)
 * - Galicia-specific patterns (local CAPE thresholds, seasonal adjustments)
 *
 * Storage: localStorage 'meteomap-storm-log' — max 500 entries (~7 days at 5min intervals)
 * Future: migrate to TimescaleDB table `storm_predictions` via ingestor
 */

import type { StormPrediction } from './stormPredictor';

interface PredictionLogEntry {
  /** Timestamp of this snapshot */
  ts: number;
  /** Prediction probability 0-100 */
  prob: number;
  /** Horizon: i=imminent, l=likely, p=possible, n=none */
  hz: string;
  /** Severity: x=extreme, s=severe, m=moderate, n=none */
  sv: string;
  /** Signal weights as compact array [cape, precip, cloud, lightning, approach, shadow, gusts, mgWarning] */
  sw: number[];
  /** Was lightning actually active at this moment? */
  hasLightning: boolean;
  /** Sector ID */
  sector: string;
}

const STORAGE_KEY = 'meteomap-storm-log';
const MAX_ENTRIES = 500;
const MIN_LOG_INTERVAL_MS = 5 * 60_000; // Don't log more often than 5 min

let lastLogTime = 0;

/**
 * Log a prediction snapshot if conditions warrant.
 * Call this from the prediction hook or effect.
 */
export function logPredictionSnapshot(
  prediction: StormPrediction,
  hasLightning: boolean,
  sectorId: string,
): void {
  const now = Date.now();

  // Only log if there's something interesting (prob > 0 OR lightning active)
  if (prediction.probability === 0 && !hasLightning) return;

  // Throttle to 5 min intervals
  if (now - lastLogTime < MIN_LOG_INTERVAL_MS) return;
  lastLogTime = now;

  const entry: PredictionLogEntry = {
    ts: now,
    prob: prediction.probability,
    hz: prediction.horizon[0], // i/l/p/n
    sv: prediction.severity[0], // x/s/m/n
    sw: prediction.signals.map((s) => Math.round(s.weight * 100) / 100),
    hasLightning,
    sector: sectorId,
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const log: PredictionLogEntry[] = raw ? JSON.parse(raw) : [];

    log.push(entry);

    // Trim to max entries (keep most recent)
    while (log.length > MAX_ENTRIES) {
      log.shift();
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

/**
 * Get all logged prediction entries for analysis.
 */
export function getPredictionLog(): PredictionLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Compute basic accuracy stats from the log.
 * "Hit" = prediction prob > 40% AND lightning confirmed later.
 * "False alarm" = prediction prob > 40% BUT no lightning.
 * "Miss" = lightning present BUT prediction was < 20%.
 */
export function computePredictionAccuracy(): {
  totalEntries: number;
  stormEvents: number;
  hits: number;
  falseAlarms: number;
  misses: number;
  hitRate: number;
  falseAlarmRate: number;
} {
  const log = getPredictionLog();
  if (log.length === 0) {
    return { totalEntries: 0, stormEvents: 0, hits: 0, falseAlarms: 0, misses: 0, hitRate: 0, falseAlarmRate: 0 };
  }

  let hits = 0;
  let falseAlarms = 0;
  let misses = 0;
  let stormEvents = 0;

  for (const entry of log) {
    if (entry.hasLightning) stormEvents++;

    if (entry.prob >= 40 && entry.hasLightning) {
      hits++;
    } else if (entry.prob >= 40 && !entry.hasLightning) {
      falseAlarms++;
    } else if (entry.prob < 20 && entry.hasLightning) {
      misses++;
    }
  }

  const predictions = hits + falseAlarms;
  return {
    totalEntries: log.length,
    stormEvents,
    hits,
    falseAlarms,
    misses,
    hitRate: predictions > 0 ? hits / predictions : 0,
    falseAlarmRate: predictions > 0 ? falseAlarms / predictions : 0,
  };
}
