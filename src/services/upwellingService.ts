/**
 * Upwelling Detector — Galician coastal upwelling detection.
 *
 * Galician Rías experience cold upwelling when sustained N/NW winds (>12kt, >6h)
 * push surface water offshore via Ekman transport, pulling cold deep water up.
 * This is a dominant oceanographic feature of the Galician coast (NW Iberia).
 *
 * Detection signals:
 *   1. SST drop ≥1.5°C over 6-24h (primary indicator)
 *   2. Sustained N/NW wind ≥12kt for ≥6h (Ekman driver)
 *   3. NAO+ phase amplifies westerlies → more upwelling (optional context)
 *
 * Uses buoy SST history buffer (accumulated in buoyStore) — no extra API calls.
 * Pure computation — no React, no stores.
 */

import type { BuoyReading } from '../api/buoyClient';
import type { AlertLevel } from '../types/campo';
import type { UnifiedAlert } from './alertService';
import type { SSTSnapshot } from '../store/buoyStore';
import { msToKnots } from './windUtils';

// ── Types ────────────────────────────────────────────────────

export interface UpwellingRisk {
  level: AlertLevel;
  /** SST change over detection window (negative = cooling = upwelling) */
  sstDelta: number | null;
  /** Current SST (°C) */
  sstCurrent: number | null;
  /** SST at start of window (°C) */
  sstPrevious: number | null;
  /** Hours of sustained N/NW wind detected */
  windHours: number;
  /** Average wind speed during upwelling-favorable period (kt) */
  avgWindKt: number | null;
  /** Detection window used (hours) */
  windowHours: number;
  /** Confidence 0-100 */
  confidence: number;
  /** Spanish explanation */
  hypothesis: string;
  /** Source buoy */
  sourceBuoy: string | null;
}

// ── Constants ────────────────────────────────────────────────

/** Minimum SST drop to flag upwelling (°C, negative) */
const SST_DROP_MODERATE = -1.5;
const SST_DROP_HIGH = -2.5;
const SST_DROP_CRITICAL = -4.0;

/** Minimum wind speed for Ekman transport (kt) */
const MIN_WIND_KT = 12;

/** Minimum hours of sustained upwelling-favorable wind */
const MIN_WIND_HOURS = 6;

/** Upwelling-favorable wind directions: N, NNW, NW, NNE (315-45°) */
function isUpwellingWind(dir: number): boolean {
  // N=360/0, NNW=337.5, NW=315, NNE=22.5
  return dir >= 315 || dir <= 45;
}

// ── SST Trend Analysis ──────────────────────────────────────

/**
 * Compute SST delta from history buffer.
 * Uses oldest available reading vs latest to compute change.
 */
function computeSSTTrend(
  history: SSTSnapshot[],
  minWindowMs: number = 3 * 3600_000 // at least 3h of data
): { delta: number; hoursSpan: number; oldest: number; newest: number } | null {
  if (history.length < 2) return null;

  const sorted = [...history].sort((a, b) => a.time - b.time);
  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];

  const spanMs = newest.time - oldest.time;
  if (spanMs < minWindowMs) return null;

  return {
    delta: newest.waterTemp - oldest.waterTemp,
    hoursSpan: spanMs / 3600_000,
    oldest: oldest.waterTemp,
    newest: newest.waterTemp,
  };
}

/**
 * Count hours of sustained upwelling-favorable wind from history.
 * Looks for consecutive snapshots with N/NW wind ≥ threshold.
 */
function countUpwellingWindHours(history: SSTSnapshot[]): {
  hours: number;
  avgKt: number | null;
} {
  if (history.length < 2) return { hours: 0, avgKt: null };

  const sorted = [...history].sort((a, b) => a.time - b.time);
  let consecutiveMs = 0;
  let windSpeeds: number[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const prevOk = prev.windDir !== null && prev.windSpeed !== null
      && isUpwellingWind(prev.windDir) && msToKnots(prev.windSpeed) >= MIN_WIND_KT;
    const currOk = curr.windDir !== null && curr.windSpeed !== null
      && isUpwellingWind(curr.windDir) && msToKnots(curr.windSpeed) >= MIN_WIND_KT;

    if (prevOk && currOk) {
      consecutiveMs += curr.time - prev.time;
      windSpeeds.push(msToKnots(curr.windSpeed!));
    }
  }

  const hours = consecutiveMs / 3600_000;
  const avgKt = windSpeeds.length > 0
    ? windSpeeds.reduce((a, b) => a + b, 0) / windSpeeds.length
    : null;

  return { hours, avgKt };
}

// ── Main Assessment ─────────────────────────────────────────

/**
 * Assess upwelling risk for a single buoy.
 */
function assessBuoyUpwelling(
  buoy: BuoyReading,
  history: SSTSnapshot[]
): UpwellingRisk {
  const noRisk: UpwellingRisk = {
    level: 'none',
    sstDelta: null,
    sstCurrent: buoy.waterTemp,
    sstPrevious: null,
    windHours: 0,
    avgWindKt: null,
    windowHours: 0,
    confidence: 0,
    hypothesis: 'Sin historial SST suficiente',
    sourceBuoy: buoy.stationName,
  };

  // Need SST history
  const trend = computeSSTTrend(history);
  if (!trend) return noRisk;

  // Check wind history
  const { hours: windHours, avgKt } = countUpwellingWindHours(history);

  const delta = trend.delta;
  const notes: string[] = [];
  let level: AlertLevel = 'none';
  let confidence = 0;

  // ── Level determination from SST drop ──────────────
  if (delta <= SST_DROP_CRITICAL) {
    level = 'critico';
    notes.push(`SST cayó ${Math.abs(delta).toFixed(1)}°C en ${trend.hoursSpan.toFixed(0)}h — upwelling intenso`);
    confidence += 50;
  } else if (delta <= SST_DROP_HIGH) {
    level = 'alto';
    notes.push(`SST cayó ${Math.abs(delta).toFixed(1)}°C en ${trend.hoursSpan.toFixed(0)}h — upwelling activo`);
    confidence += 40;
  } else if (delta <= SST_DROP_MODERATE) {
    level = 'riesgo';
    notes.push(`SST bajó ${Math.abs(delta).toFixed(1)}°C en ${trend.hoursSpan.toFixed(0)}h — posible upwelling`);
    confidence += 25;
  } else {
    // No significant SST drop — check if wind suggests upwelling starting
    if (windHours >= MIN_WIND_HOURS && delta < 0) {
      level = 'riesgo';
      notes.push(`Viento N/NW sostenido ${windHours.toFixed(0)}h — upwelling incipiente`);
      confidence += 20;
    } else {
      return {
        ...noRisk,
        sstDelta: delta,
        sstPrevious: trend.oldest,
        windowHours: trend.hoursSpan,
        hypothesis: `SST estable (${delta > 0 ? '+' : ''}${delta.toFixed(1)}°C) — sin upwelling`,
      };
    }
  }

  // ── Wind confirmation boosts confidence ────────────
  if (windHours >= MIN_WIND_HOURS) {
    confidence += 25;
    notes.push(`Viento N/NW ${windHours.toFixed(0)}h · ${avgKt?.toFixed(0) ?? '?'}kt medio`);
    // Escalate if both SST and wind confirm
    if (level === 'riesgo' && delta <= SST_DROP_MODERATE) {
      level = 'alto';
    }
  } else if (windHours >= 3) {
    confidence += 10;
    notes.push(`Viento favorable ${windHours.toFixed(0)}h (insuficiente para confirmación)`);
  }

  // ── Data quality bonus ─────────────────────────────
  if (trend.hoursSpan >= 12) confidence += 15;
  else if (trend.hoursSpan >= 6) confidence += 10;

  if (history.length >= 20) confidence += 10; // Many data points

  confidence = Math.min(100, confidence);

  return {
    level,
    sstDelta: delta,
    sstCurrent: trend.newest,
    sstPrevious: trend.oldest,
    windHours,
    avgWindKt: avgKt,
    windowHours: trend.hoursSpan,
    confidence,
    hypothesis: notes.join(' · '),
    sourceBuoy: buoy.stationName,
  };
}

// ── Public API ──────────────────────────────────────────────

/**
 * Assess upwelling across all buoys with SST history.
 * Returns the worst-case risk.
 */
export function assessUpwellingRisk(
  buoys: BuoyReading[],
  sstHistory: Map<number, SSTSnapshot[]>
): UpwellingRisk {
  let worst: UpwellingRisk | null = null;
  const LEVEL_ORDER: Record<AlertLevel, number> = { none: 0, riesgo: 1, alto: 2, critico: 3 };

  for (const buoy of buoys) {
    if (buoy.waterTemp === null) continue;
    const history = sstHistory.get(buoy.stationId);
    if (!history || history.length < 2) continue;

    const risk = assessBuoyUpwelling(buoy, history);
    if (!worst || LEVEL_ORDER[risk.level] > LEVEL_ORDER[worst.level]) {
      worst = risk;
    }
  }

  return worst ?? {
    level: 'none',
    sstDelta: null,
    sstCurrent: null,
    sstPrevious: null,
    windHours: 0,
    avgWindKt: null,
    windowHours: 0,
    confidence: 0,
    hypothesis: 'Sin datos de boyas con SST',
    sourceBuoy: null,
  };
}

/**
 * Build UnifiedAlert[] from upwelling assessment.
 */
export function buildUpwellingAlerts(
  buoys: BuoyReading[],
  sstHistory: Map<number, SSTSnapshot[]>
): UnifiedAlert[] {
  const risk = assessUpwellingRisk(buoys, sstHistory);
  if (risk.level === 'none') return [];

  const levelToScore: Record<AlertLevel, number> = {
    none: 0, riesgo: 30, alto: 55, critico: 80,
  };
  const score = levelToScore[risk.level];
  const severity = score >= 80 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'moderate' : 'info';

  const buoyStr = risk.sourceBuoy ? ` (${risk.sourceBuoy})` : '';
  const deltaStr = risk.sstDelta !== null ? `SST ${risk.sstDelta > 0 ? '+' : ''}${risk.sstDelta.toFixed(1)}°C` : '';
  const windStr = risk.windHours >= MIN_WIND_HOURS
    ? `N/NW ${risk.windHours.toFixed(0)}h`
    : '';
  const tempStr = risk.sstCurrent !== null ? `${risk.sstCurrent.toFixed(1)}°C` : '';

  return [{
    id: 'upwelling',
    category: 'storm', // Safety: uses storm for high visibility
    severity: severity as 'info' | 'moderate' | 'high' | 'critical',
    score,
    icon: 'thermometer',
    title: risk.level === 'critico'
      ? 'UPWELLING INTENSO'
      : risk.level === 'alto'
        ? 'Upwelling activo'
        : 'Upwelling incipiente',
    detail: [deltaStr, windStr, tempStr, buoyStr].filter(Boolean).join(' · '),
    urgent: risk.level === 'critico',
    updatedAt: new Date(),
    confidence: risk.confidence,
  }];
}
