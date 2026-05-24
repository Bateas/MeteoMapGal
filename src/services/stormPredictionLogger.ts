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

// Defense in depth against duplicate logging. The ingestor side now
// truncates the timestamp to the minute and relies on ON CONFLICT DO
// NOTHING for the canonical dedup. Here on the frontend we additionally
// short-circuit when the snapshot has identical content (probability +
// horizon + severity + sector + lightning state) to the previous one,
// even if more than 5 min passed — no point in logging "same prediction"
// just because time elapsed.
let lastLogged: { time: number; key: string } | null = null;

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

  // Content key — collapses identical-state snapshots into one log entry
  // regardless of how often the upstream effect fires.
  const key = `${sectorId}|${prediction.probability}|${prediction.horizon}|${prediction.severity}|${hasLightning ? '1' : '0'}`;

  // Throttle: skip if same content as last log (any time gap) OR same time-window
  if (lastLogged) {
    if (lastLogged.key === key) return;
    if (now - lastLogged.time < MIN_LOG_INTERVAL_MS) return;
  }
  lastLogged = { time: now, key };

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

  // Also send to ingestor API for persistent TimescaleDB storage
  try {
    fetch('/api/v1/storm-predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sector: sectorId,
        probability: prediction.probability,
        horizon: prediction.horizon,
        severity: prediction.severity,
        hasLightning,
        signals: prediction.signals.map((s) => Math.round(s.weight * 100) / 100),
      }),
    }).catch(() => {}); // Fire-and-forget, don't block UI
  } catch {
    // Network unavailable — silently skip
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
