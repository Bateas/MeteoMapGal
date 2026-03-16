/**
 * Thermal Verification Service — Log precursor predictions vs actual outcomes.
 *
 * Analogous to forecastVerificationService:
 * 1. Log precursor predictions hourly (from thermalPrecursorService)
 * 2. Log actual thermal occurrence (thermal boost activated? WSW ≥5kt at spot?)
 * 3. Compare prediction vs outcome → hit/miss/false-alarm
 * 4. Accumulate accuracy stats over days → improve trust in precursor signals
 *
 * Uses localStorage for persistence (no backend needed).
 * Keeps last 30 days of verification records.
 */

import type { ThermalPrecursorResult } from './thermalPrecursorService';
import type { SpotScore } from './spotScoringEngine';

// ── Types ────────────────────────────────────────────────

export interface ThermalPrediction {
  spotId: string;
  timestamp: number;           // ms
  probability: number;         // 0-100 from precursor service
  level: string;               // 'none' | 'watch' | 'probable' | 'imminent' | 'active'
  activeSignalCount: number;
  eta: string | null;
}

export interface ThermalOutcome {
  spotId: string;
  date: string;                // YYYY-MM-DD
  thermalDetected: boolean;    // was thermal boost triggered OR WSW ≥5kt?
  peakWindKt: number;          // max wind speed during 13-18h
  peakDir: number | null;      // dominant direction during thermal window
  thermalBoosted: boolean;     // was thermal boost applied in scoring?
  windowStart: number | null;  // hour of thermal onset (13-18)
  windowEnd: number | null;    // hour thermal ended
}

export interface VerificationRecord {
  spotId: string;
  date: string;                // YYYY-MM-DD
  morningPrediction: ThermalPrediction | null;  // best prediction before 12h
  outcome: ThermalOutcome | null;
  result: 'hit' | 'miss' | 'false-alarm' | 'correct-reject' | 'pending';
}

export interface VerificationStats {
  spotId: string;
  totalDays: number;
  hits: number;                // predicted + happened
  misses: number;              // not predicted + happened
  falseAlarms: number;         // predicted + didn't happen
  correctRejects: number;      // not predicted + didn't happen
  accuracy: number;            // (hits + correctRejects) / total
  hitRate: number;             // hits / (hits + misses) — sensitivity
  falseAlarmRate: number;      // falseAlarms / (falseAlarms + correctRejects)
  avgLeadTimeMin: number;      // average prediction lead time for hits
}

// ── Constants ────────────────────────────────────────────

const STORAGE_KEY = 'thermal_verification';
const MAX_DAYS = 30;
const PREDICTION_THRESHOLD = 40;  // probability ≥40% counts as "predicted"
const THERMAL_WIND_THRESHOLD = 5; // ≥5kt WSW counts as "thermal occurred"

// ── Public API ───────────────────────────────────────────

/**
 * Log a precursor prediction (called hourly during thermal season).
 * Keeps the best morning prediction (highest probability before 12h).
 */
export function logPrediction(precursor: ThermalPrecursorResult): void {
  const records = loadRecords();
  const today = formatDate(new Date(precursor.computedAt));
  const key = `${precursor.spotId}_${today}`;

  let record = records.get(key);
  if (!record) {
    record = {
      spotId: precursor.spotId,
      date: today,
      morningPrediction: null,
      outcome: null,
      result: 'pending',
    };
  }

  const hour = precursor.computedAt.getHours();

  // Keep the best morning prediction (before 13h, highest probability)
  if (hour < 13) {
    const pred: ThermalPrediction = {
      spotId: precursor.spotId,
      timestamp: precursor.computedAt.getTime(),
      probability: precursor.probability,
      level: precursor.level,
      activeSignalCount: Object.values(precursor.signals).filter(s => s.active).length,
      eta: precursor.eta,
    };

    if (!record.morningPrediction || pred.probability > record.morningPrediction.probability) {
      record.morningPrediction = pred;
    }
  }

  records.set(key, record);
  saveRecords(records);
}

/**
 * Log an actual thermal outcome (called at end of thermal window, ~19h).
 * Uses spot scores accumulated during the afternoon.
 */
export function logOutcome(
  spotId: string,
  afternoonScores: SpotScore[],
  date: Date = new Date(),
): void {
  const records = loadRecords();
  const dateStr = formatDate(date);
  const key = `${spotId}_${dateStr}`;

  let record = records.get(key);
  if (!record) {
    record = {
      spotId,
      date: dateStr,
      morningPrediction: null,
      outcome: null,
      result: 'pending',
    };
  }

  // Analyze afternoon scores (13-18h)
  const thermalScores = afternoonScores.filter(s => {
    const h = s.computedAt.getHours();
    return h >= 13 && h <= 18;
  });

  const thermalDetected = thermalScores.some(s =>
    s.thermalBoosted ||
    (s.wind && s.wind.avgSpeedKt >= THERMAL_WIND_THRESHOLD &&
     s.wind.dirDeg != null && angleDiffSimple(s.wind.dirDeg, 250) <= 50),
  );

  const peakScore = thermalScores.reduce((max, s) =>
    (s.wind?.avgSpeedKt ?? 0) > max ? (s.wind?.avgSpeedKt ?? 0) : max, 0);

  const boosted = thermalScores.some(s => s.thermalBoosted);

  // Find thermal window
  let windowStart: number | null = null;
  let windowEnd: number | null = null;
  for (const s of thermalScores) {
    if (s.thermalBoosted || (s.wind && s.wind.avgSpeedKt >= THERMAL_WIND_THRESHOLD)) {
      const h = s.computedAt.getHours();
      if (windowStart === null || h < windowStart) windowStart = h;
      if (windowEnd === null || h > windowEnd) windowEnd = h;
    }
  }

  record.outcome = {
    spotId,
    date: dateStr,
    thermalDetected,
    peakWindKt: peakScore,
    peakDir: thermalScores.find(s => s.wind)?.wind?.dirDeg ?? null,
    thermalBoosted: boosted,
    windowStart,
    windowEnd,
  };

  // Evaluate result
  const predicted = record.morningPrediction != null &&
    record.morningPrediction.probability >= PREDICTION_THRESHOLD;

  if (predicted && thermalDetected) record.result = 'hit';
  else if (!predicted && thermalDetected) record.result = 'miss';
  else if (predicted && !thermalDetected) record.result = 'false-alarm';
  else record.result = 'correct-reject';

  records.set(key, record);
  saveRecords(records);
}

/**
 * Get verification statistics for a spot.
 */
export function getVerificationStats(spotId: string): VerificationStats {
  const records = loadRecords();
  const spotRecords = [...records.values()].filter(r =>
    r.spotId === spotId && r.result !== 'pending',
  );

  const stats: VerificationStats = {
    spotId,
    totalDays: spotRecords.length,
    hits: 0,
    misses: 0,
    falseAlarms: 0,
    correctRejects: 0,
    accuracy: 0,
    hitRate: 0,
    falseAlarmRate: 0,
    avgLeadTimeMin: 0,
  };

  let totalLeadTime = 0;
  let hitCount = 0;

  for (const r of spotRecords) {
    switch (r.result) {
      case 'hit':
        stats.hits++;
        if (r.morningPrediction && r.outcome?.windowStart) {
          const predHour = new Date(r.morningPrediction.timestamp).getHours();
          totalLeadTime += (r.outcome.windowStart - predHour) * 60;
          hitCount++;
        }
        break;
      case 'miss': stats.misses++; break;
      case 'false-alarm': stats.falseAlarms++; break;
      case 'correct-reject': stats.correctRejects++; break;
    }
  }

  if (stats.totalDays > 0) {
    stats.accuracy = (stats.hits + stats.correctRejects) / stats.totalDays;
    stats.hitRate = stats.hits + stats.misses > 0
      ? stats.hits / (stats.hits + stats.misses) : 0;
    stats.falseAlarmRate = stats.falseAlarms + stats.correctRejects > 0
      ? stats.falseAlarms / (stats.falseAlarms + stats.correctRejects) : 0;
    stats.avgLeadTimeMin = hitCount > 0 ? totalLeadTime / hitCount : 0;
  }

  return stats;
}

/**
 * Get all verification records for a spot (for display in UI).
 */
export function getVerificationRecords(spotId: string): VerificationRecord[] {
  const records = loadRecords();
  return [...records.values()]
    .filter(r => r.spotId === spotId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ── Persistence ──────────────────────────────────────────

function loadRecords(): Map<string, VerificationRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const arr: VerificationRecord[] = JSON.parse(raw);
    const map = new Map<string, VerificationRecord>();

    // Prune old records (>MAX_DAYS)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_DAYS);
    const cutoffStr = formatDate(cutoff);

    for (const r of arr) {
      if (r.date >= cutoffStr) {
        map.set(`${r.spotId}_${r.date}`, r);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function saveRecords(records: Map<string, VerificationRecord>): void {
  try {
    const arr = [...records.values()];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function angleDiffSimple(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
