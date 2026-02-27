/**
 * Thermal scoring utilities for forecast points.
 * Extracted from ForecastTimeline.tsx for reuse across
 * ForecastTable, FieldDrawer, and alert checkers.
 */

import type { HourlyForecast } from '../types/forecast';
import type { ThermalWindRule } from '../types/thermal';
import { isDirectionInRange } from './windUtils';

// ── Types ────────────────────────────────────────────────

export interface ThermalScore {
  score: number;           // 0-100
  mainRule: string | null;  // Rule name that scored highest
  isNavigable: boolean;    // Score > 50 on a primary rule
  isPrecursor: boolean;    // Score > 40 on a precursor rule
}

// ── Scoring function ─────────────────────────────────────

/**
 * Quick thermal score for a single forecast point.
 * Simplified version of the full scoring engine — operates on forecast
 * data without needing zone grouping or station readings.
 */
export function scoreForecastThermal(
  point: HourlyForecast,
  rules: ThermalWindRule[],
  deltaT: number | null,
): ThermalScore {
  let bestScore = 0;
  let bestRule: string | null = null;
  let isNavigable = false;
  let isPrecursor = false;

  const hour = point.time.getHours();
  const month = point.time.getMonth() + 1;
  const temp = point.temperature;
  const humidity = point.humidity;
  const windSpeed = point.windSpeed;
  const windDir = point.windDirection;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    // Only score embalse rules for the forecast (forecast is at embalse location)
    if (rule.expectedWind.zone !== 'embalse' && rule.expectedWind.zone !== 'norte') continue;

    let score = 0;
    const c = rule.conditions;

    // Hard gates
    if (c.months && !c.months.includes(month)) {
      const isAdjacent = c.months.some((m) => Math.abs(m - month) === 1 || Math.abs(m - month) === 11);
      if (!isAdjacent) continue;
    }
    if (temp !== null && c.minTemp !== undefined && temp < c.minTemp - 4) continue;

    // Temperature (0-25)
    if (temp !== null && c.minTemp !== undefined) {
      if (temp >= c.minTemp) {
        score += Math.min(25, 15 + (temp - c.minTemp) * 2);
      } else {
        score += Math.max(0, 15 - (c.minTemp - temp) * 5);
      }
    }

    // Time of day (0-20)
    if (c.timeWindow) {
      const { from, to } = c.timeWindow;
      if (hour >= from && hour <= to) {
        const mid = (from + to) / 2;
        const dist = Math.abs(hour - mid);
        const windowSize = (to - from) / 2;
        score += 20 - Math.round((dist / windowSize) * 8);
      } else {
        const distToWindow = Math.min(Math.abs(hour - from), Math.abs(hour - to));
        if (distToWindow <= 2) {
          score += Math.max(0, 8 - distToWindow * 4);
        }
      }
    }

    // Season (0-15)
    if (c.months) {
      if (c.months.includes(month)) {
        if (month === 8) score += 15;
        else if (month === 7) score += 14;
        else if (month === 6) score += 9;
        else if (month === 9) score += 8;
        else score += 5;
      } else {
        score += 3;
      }
    }

    // Humidity (0-10)
    if (humidity !== null) {
      if (c.maxHumidity && humidity > c.maxHumidity) {
        score -= Math.min(15, (humidity - c.maxHumidity) * 1.5);
      } else if (humidity >= 45 && humidity <= 65) {
        score += 10;
      } else if (humidity < 45) {
        score += 6;
      } else {
        score += 4;
      }
    }

    // Wind direction (0-15)
    if (windDir !== null) {
      if (isDirectionInRange(windDir, rule.expectedWind.directionRange)) {
        score += 15;
      }
    }

    // Wind speed (0-15)
    if (windSpeed !== null) {
      if (windSpeed >= rule.expectedWind.minSpeed) {
        score += Math.min(15, 8 + windSpeed * 1.5);
      } else if (windSpeed > 0.5) {
        score += 4;
      }
    }

    // ΔT scaling
    if (deltaT !== null) {
      if (deltaT >= 20) score *= 1.15;
      else if (deltaT >= 16) score *= 1.08;
      else if (deltaT < 8) score *= 0.6;
    }

    // Cloud cover penalty
    if (point.cloudCover !== null && point.cloudCover > 70) {
      score *= 0.8;
    }

    // CAPE bonus
    if (point.cape !== null && point.cape > 200) {
      score *= 1.05;
    }

    // Evening decay — thermals die after 17:00
    if (hour >= 17) {
      const decayFactor = hour >= 20 ? 0.15 : hour >= 19 ? 0.35 : hour >= 18 ? 0.6 : 0.85;
      score *= decayFactor;
    }

    // Pressure trend — lower pressure favors convection
    if (point.pressure !== null) {
      if (point.pressure < 1010) score *= 1.08;
      else if (point.pressure < 1015) score *= 1.04;
      else if (point.pressure > 1025) score *= 0.92;
    }

    // Solar radiation boost — strong insolation heats ground → better thermals
    if (point.solarRadiation !== null) {
      if (point.solarRadiation > 700) score *= 1.15;
      else if (point.solarRadiation > 500) score *= 1.08;
      else if (point.solarRadiation < 200 && hour >= 10 && hour <= 16) score *= 0.7;
    }

    score = Math.min(100, Math.max(0, Math.round(score)));

    if (score > bestScore) {
      bestScore = score;
      bestRule = rule.name;

      const isPrimaryRule = rule.id.startsWith('thermal_');
      const isPrecursorRule = rule.id.startsWith('precursor_');
      if (isPrimaryRule && score >= 50) isNavigable = true;
      if (isPrecursorRule && score >= 40) isPrecursor = true;
    }
  }

  return { score: bestScore, mainRule: bestRule, isNavigable, isPrecursor };
}

// ── Color helpers ────────────────────────────────────────

export function thermalColor(score: number): string {
  if (score < 20) return 'transparent';
  if (score < 40) return '#3b82f6';
  if (score < 55) return '#f59e0b';
  if (score < 75) return '#f97316';
  return '#ef4444';
}

export function thermalBg(score: number): string {
  if (score < 20) return 'transparent';
  if (score < 40) return 'rgba(59,130,246,0.1)';
  if (score < 55) return 'rgba(245,158,11,0.1)';
  if (score < 75) return 'rgba(249,115,22,0.15)';
  return 'rgba(239,68,68,0.18)';
}
