/**
 * Best Sailing Window service — "¿Cuándo salgo?"
 *
 * Scans 48h forecast per spot → finds contiguous good-condition windows.
 * Different scoring for thermal-dominant (Embalse) vs wind-dominant (Rías).
 *
 * Pure functions, no React dependencies.
 */

import type { HourlyForecast } from '../types/forecast';
import type { ThermalWindRule } from '../types/thermal';
import type { SailingSpot, SpotId } from '../config/spots';
import { scoreForecastThermal } from './forecastScoringUtils';
import { msToKnots, degreesToCardinal, angleDifference } from './windUtils';

// ── Types ────────────────────────────────────────────────────

export interface WindowHourScore {
  time: Date;
  score: number;     // 0-100
  windKt: number;
  windDir: number | null;
  verdict: 'good' | 'marginal' | 'poor';
  label: string;     // "14kt SW ☀️"
}

export interface SailingWindow {
  start: Date;
  end: Date;
  hours: number;
  avgScore: number;
  peakScore: number;
  avgWindKt: number;
  dominantDir: string;
  verdict: 'good' | 'marginal';
  summary: string;    // "14-18h · 14kt SW · Bueno"
}

export interface SpotWindowResult {
  spotId: SpotId;
  windows: SailingWindow[];
  hourlyScores: WindowHourScore[];
  bestWindow: SailingWindow | null;
  nextGoodHour: Date | null;
  fetchedAt: Date;
}

// ── Thresholds ───────────────────────────────────────────────

const GOOD_THRESHOLD = 60;
const MARGINAL_THRESHOLD = 35;
const MIN_WINDOW_HOURS = 2;
const MERGE_GAP_HOURS = 1;

// ── Per-hour scoring ─────────────────────────────────────────

/**
 * Score a single forecast hour for a spot.
 * Thermal spots delegate to scoreForecastThermal(); wind spots use custom curve.
 */
export function scoreHourForSpot(
  hour: HourlyForecast,
  spot: SailingSpot,
  rules?: ThermalWindRule[],
): WindowHourScore {
  const windSpeedMs = hour.windSpeed ?? 0;
  const windKt = Math.round(msToKnots(windSpeedMs));
  const windDir = hour.windDirection;
  const dirLabel = windDir !== null ? degreesToCardinal(windDir) : '';

  let score: number;

  if (spot.thermalDetection && rules && rules.length > 0) {
    // ── Thermal-dominant scoring (Embalse spots) ──
    const deltaT = computeForecastDeltaT(hour);
    const thermal = scoreForecastThermal(hour, rules, deltaT);
    score = thermal.score;

    // Precip hard gate
    if (hour.precipProbability !== null && hour.precipProbability > 60) {
      score = Math.min(score, 15);
    }
  } else {
    // ── Wind-dominant scoring (Rías spots) ──
    score = scoreWindHour(hour, spot);
  }

  score = Math.min(100, Math.max(0, Math.round(score)));

  const verdict: WindowHourScore['verdict'] =
    score >= GOOD_THRESHOLD ? 'good' :
    score >= MARGINAL_THRESHOLD ? 'marginal' : 'poor';

  const dayIcon = hour.isDay ? 'dia' : 'noche';
  const label = windKt > 0
    ? `${windKt}kt ${dirLabel} ${dayIcon}`
    : `Calma ${dayIcon}`;

  return { time: hour.time, score, windKt, windDir, verdict, label };
}

/**
 * Wind-dominant scoring for Rías spots.
 * Peak at 14-18kt, pattern match bonus, wave/precip penalties.
 */
function scoreWindHour(hour: HourlyForecast, spot: SailingSpot): number {
  const windSpeedMs = hour.windSpeed ?? 0;
  const windKt = msToKnots(windSpeedMs);
  const windDir = hour.windDirection;
  let score = 0;

  // Wind speed curve (0-45) — peak at 14-18kt
  if (windKt < 4) {
    score += 0;
  } else if (windKt < 8) {
    score += (windKt - 4) * 5; // 0-20 ramp
  } else if (windKt < 12) {
    score += 20 + (windKt - 8) * 4; // 20-36 ramp
  } else if (windKt <= 18) {
    score += 36 + Math.min(9, (windKt - 12) * 1.5); // 36-45 plateau
  } else if (windKt <= 25) {
    score += Math.max(15, 45 - (windKt - 18) * 4); // 45→15 decline
  } else {
    score += 5; // Gale — barely counts
  }

  // Wind direction match (0-20) — check against spot's known patterns
  if (windDir !== null && spot.windPatterns.length > 0) {
    let bestPatternMatch = 0;
    for (const pattern of spot.windPatterns) {
      const diff = angleDifference(windDir, pattern.direction);
      if (diff < 30) bestPatternMatch = Math.max(bestPatternMatch, 20);
      else if (diff < 60) bestPatternMatch = Math.max(bestPatternMatch, 12);
      else if (diff < 90) bestPatternMatch = Math.max(bestPatternMatch, 5);
    }
    score += bestPatternMatch;
  } else if (windDir !== null) {
    // No patterns defined — any direction with wind is acceptable
    score += 10;
  }

  // Daylight bonus (0-10)
  if (hour.isDay) score += 10;

  // Gustiness penalty — high gusts relative to sustained = uncomfortable
  if (hour.windGusts !== null && windSpeedMs > 0) {
    const gustRatio = hour.windGusts / windSpeedMs;
    if (gustRatio > 2.0) score -= 10;
    else if (gustRatio > 1.6) score -= 5;
  }

  // Precipitation penalty
  if (hour.precipProbability !== null) {
    if (hour.precipProbability > 70) score -= 20;
    else if (hour.precipProbability > 40) score -= 10;
    else if (hour.precipProbability > 20) score -= 5;
  }

  // Cloud cover mild penalty (sailors don't mind clouds, but want some visibility)
  if (hour.cloudCover !== null && hour.cloudCover > 90) {
    score -= 5;
  }

  // Wave height hard gate (if spot has maxWaveHeight)
  if (spot.hardGates.maxWaveHeight) {
    // We don't have wave forecast in Open-Meteo standard API,
    // but gusty high wind → proxy for rough seas at exposed spots
    if (spot.waveRelevance === 'critical' && windKt > 22) {
      score -= 15;
    }
  }

  // Max wind hard gate
  if (spot.hardGates.maxWindKt && windKt > spot.hardGates.maxWindKt) {
    score = Math.min(score, 5);
  }

  return score;
}

/**
 * Estimate ΔT (max - current) from forecast for thermal scoring.
 * Uses same-day max temperature vs current hour temperature.
 */
function computeForecastDeltaT(hour: HourlyForecast): number | null {
  if (hour.temperature === null) return null;
  // Simple proxy: assume max is ~8°C above current morning temp
  // Real ΔT needs time series — this is a rough estimate
  const h = hour.time.getHours();
  if (h >= 12 && h <= 16 && hour.temperature > 20) return hour.temperature - 10;
  if (h >= 10 && h <= 18) return Math.max(8, hour.temperature - 8);
  return null;
}

// ── Window detection ─────────────────────────────────────────

/**
 * Group consecutive hours with score ≥ MARGINAL_THRESHOLD into sailing windows.
 * Merges windows separated by ≤ MERGE_GAP_HOURS of poor scores.
 * Filters windows shorter than MIN_WINDOW_HOURS.
 */
export function findSailingWindows(hourlyScores: WindowHourScore[]): SailingWindow[] {
  if (hourlyScores.length === 0) return [];

  // 1. Find raw contiguous runs of marginal+ hours
  const runs: WindowHourScore[][] = [];
  let currentRun: WindowHourScore[] = [];

  for (const h of hourlyScores) {
    if (h.score >= MARGINAL_THRESHOLD) {
      currentRun.push(h);
    } else {
      if (currentRun.length > 0) {
        runs.push(currentRun);
        currentRun = [];
      }
    }
  }
  if (currentRun.length > 0) runs.push(currentRun);

  // 2. Merge runs separated by ≤ MERGE_GAP_HOURS
  const merged: WindowHourScore[][] = [];
  for (const run of runs) {
    if (merged.length === 0) {
      merged.push(run);
      continue;
    }
    const prev = merged[merged.length - 1];
    const prevEnd = prev[prev.length - 1].time.getTime();
    const runStart = run[0].time.getTime();
    const gapHours = (runStart - prevEnd) / 3_600_000;

    if (gapHours <= MERGE_GAP_HOURS + 1) {
      // Merge — include gap hours with their original scores
      merged[merged.length - 1] = [...prev, ...run];
    } else {
      merged.push(run);
    }
  }

  // 3. Filter by minimum duration and build SailingWindow objects
  return merged
    .filter((run) => run.length >= MIN_WINDOW_HOURS)
    .map((run) => buildWindow(run));
}

function buildWindow(hours: WindowHourScore[]): SailingWindow {
  const start = hours[0].time;
  const end = new Date(hours[hours.length - 1].time.getTime() + 3_600_000); // +1h for end
  const numHours = hours.length;

  const avgScore = Math.round(hours.reduce((s, h) => s + h.score, 0) / numHours);
  const peakScore = Math.max(...hours.map((h) => h.score));
  const avgWindKt = Math.round(hours.reduce((s, h) => s + h.windKt, 0) / numHours);

  // Dominant direction — most common cardinal from hours with wind
  const dirCounts = new Map<string, number>();
  for (const h of hours) {
    if (h.windDir !== null) {
      const card = degreesToCardinal(h.windDir);
      dirCounts.set(card, (dirCounts.get(card) ?? 0) + 1);
    }
  }
  let dominantDir = '';
  let maxCount = 0;
  for (const [dir, count] of dirCounts) {
    if (count > maxCount) { dominantDir = dir; maxCount = count; }
  }

  const verdict: SailingWindow['verdict'] = avgScore >= GOOD_THRESHOLD ? 'good' : 'marginal';

  const timeLabel = formatWindowTime(start, end);
  const verdictLabel = verdict === 'good' ? 'Bueno' : 'Marginal';
  const summary = `${timeLabel} · ${avgWindKt}kt ${dominantDir} · ${verdictLabel}`;

  return { start, end, hours: numHours, avgScore, peakScore, avgWindKt, dominantDir, verdict, summary };
}

// ── Time formatting ──────────────────────────────────────────

function formatWindowTime(start: Date, end: Date): string {
  const now = new Date();
  const startH = start.getHours();
  const endH = end.getHours();
  const timeRange = `${startH}-${endH}h`;

  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((startDay.getTime() - today.getTime()) / 86_400_000);

  if (diffDays === 0) return `Hoy ${timeRange}`;
  if (diffDays === 1) return `Mañana ${timeRange}`;

  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  return `${dayNames[start.getDay()]} ${timeRange}`;
}

// ── Main orchestrator ────────────────────────────────────────

/**
 * Compute sailing windows for a spot from forecast data.
 */
export function computeSpotWindows(
  forecast: HourlyForecast[],
  spot: SailingSpot,
  rules?: ThermalWindRule[],
): SpotWindowResult {
  // Only score future hours
  const now = Date.now();
  const futureHours = forecast.filter((h) => h.time.getTime() > now);

  const hourlyScores = futureHours.map((h) => scoreHourForSpot(h, spot, rules));
  const windows = findSailingWindows(hourlyScores);

  // Best window = highest avgScore
  const bestWindow = windows.length > 0
    ? windows.reduce((best, w) => w.avgScore > best.avgScore ? w : best)
    : null;

  // Next good hour = first future hour with score ≥ GOOD_THRESHOLD
  const nextGood = hourlyScores.find((h) => h.score >= GOOD_THRESHOLD);
  const nextGoodHour = nextGood?.time ?? null;

  return {
    spotId: spot.id,
    windows,
    hourlyScores,
    bestWindow,
    nextGoodHour,
    fetchedAt: new Date(),
  };
}
