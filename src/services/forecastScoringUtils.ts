/**
 * Thermal scoring utilities for forecast points.
 * Extracted from ForecastTimeline.tsx for reuse across
 * ForecastTable, FieldDrawer, and alert checkers.
 */

import type { HourlyForecast } from '../types/forecast';
import type { ThermalWindRule } from '../types/thermal';
import { isDirectionInRange } from './windUtils';

// ── Types ────────────────────────────────────────────────

/** Breakdown of forecast thermal score components (for tooltip display) */
export interface ForecastBreakdown {
  temperature: number;     // 0-25
  timeOfDay: number;       // 0-20
  season: number;          // 0-15
  humidity: number;        // -15 to 10
  windDirection: number;   // 0-15
  windSpeed: number;       // 0-15
  baseTotal: number;       // Sum before multipliers
  multipliers: { label: string; factor: number }[];
}

export interface ThermalScore {
  score: number;           // 0-100
  mainRule: string | null;  // Rule name that scored highest
  isNavigable: boolean;    // Score > 50 on a primary rule
  isPrecursor: boolean;    // Score > 40 on a precursor rule
  breakdown: ForecastBreakdown | null; // Detailed breakdown (only for best rule)
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
  let bestBreakdown: ForecastBreakdown | null = null;

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

    // Track component scores for breakdown
    let bkTemp = 0;
    let bkTime = 0;
    let bkSeason = 0;
    let bkHumidity = 0;
    let bkDir = 0;
    let bkSpeed = 0;

    // Temperature (0-25)
    if (temp !== null && c.minTemp !== undefined) {
      if (temp >= c.minTemp) {
        bkTemp = Math.min(25, 15 + (temp - c.minTemp) * 2);
      } else {
        bkTemp = Math.max(0, 15 - (c.minTemp - temp) * 5);
      }
      score += bkTemp;
    }

    // Time of day (0-20)
    if (c.timeWindow) {
      const { from, to } = c.timeWindow;
      if (hour >= from && hour <= to) {
        const mid = (from + to) / 2;
        const dist = Math.abs(hour - mid);
        const windowSize = (to - from) / 2;
        bkTime = 20 - Math.round((dist / windowSize) * 8);
      } else {
        const distToWindow = Math.min(Math.abs(hour - from), Math.abs(hour - to));
        if (distToWindow <= 2) {
          bkTime = Math.max(0, 8 - distToWindow * 4);
        }
      }
      score += bkTime;
    }

    // Season (0-15)
    if (c.months) {
      if (c.months.includes(month)) {
        if (month === 8) bkSeason = 15;
        else if (month === 7) bkSeason = 14;
        else if (month === 6) bkSeason = 9;
        else if (month === 9) bkSeason = 8;
        else bkSeason = 5;
      } else {
        bkSeason = 3;
      }
      score += bkSeason;
    }

    // Humidity (0-10)
    if (humidity !== null) {
      if (c.maxHumidity && humidity > c.maxHumidity) {
        bkHumidity = -Math.min(15, (humidity - c.maxHumidity) * 1.5);
      } else if (humidity >= 45 && humidity <= 65) {
        bkHumidity = 10;
      } else if (humidity < 45) {
        bkHumidity = 6;
      } else {
        bkHumidity = 4;
      }
      score += bkHumidity;
    }

    // Wind direction (0-15)
    if (windDir !== null) {
      if (isDirectionInRange(windDir, rule.expectedWind.directionRange)) {
        bkDir = 15;
      }
      score += bkDir;
    }

    // Wind speed (0-15) — harder scale: need >4 m/s (~8kt) for decent score
    if (windSpeed !== null) {
      const kt = windSpeed * 1.94384;
      if (kt >= 18) {
        bkSpeed = 15; // 18kt+ = max score
      } else if (kt >= 13) {
        bkSpeed = 12; // 13-18kt = great
      } else if (kt >= 9) {
        bkSpeed = 8;  // 9-13kt = good
      } else if (kt >= 6) {
        bkSpeed = 4;  // 6-9kt = marginal
      } else {
        bkSpeed = 1;  // <6kt = barely counts
      }
      score += bkSpeed;
    }

    const baseTotal = Math.round(score);

    // Collect multipliers
    const multipliers: ForecastBreakdown['multipliers'] = [];

    // ΔT scaling
    if (deltaT !== null) {
      if (deltaT >= 20) { score *= 1.15; multipliers.push({ label: 'ΔT alto', factor: 1.15 }); }
      else if (deltaT >= 16) { score *= 1.08; multipliers.push({ label: 'ΔT mod.', factor: 1.08 }); }
      else if (deltaT < 8) { score *= 0.6; multipliers.push({ label: 'ΔT bajo', factor: 0.6 }); }
    }

    // Cloud cover penalty — sun makes the difference between good and great
    if (point.cloudCover !== null) {
      if (point.cloudCover > 85) {
        score *= 0.7; multipliers.push({ label: 'Cubierto', factor: 0.7 });
      } else if (point.cloudCover > 60) {
        score *= 0.85; multipliers.push({ label: 'Nubes', factor: 0.85 });
      }
      // Bonus for clear sky (sun amplifies thermal + comfort)
      if (point.cloudCover < 20) {
        score *= 1.08; multipliers.push({ label: 'Sol', factor: 1.08 });
      }
    }

    // Cold penalty — sailing in cold is not a "great day" even with wind
    if (temp !== null && temp < 12) {
      const coldFactor = Math.max(0.6, 1 - (12 - temp) * 0.04);
      score *= coldFactor;
      multipliers.push({ label: 'Frio', factor: Math.round(coldFactor * 100) / 100 });
    }

    // CAPE bonus
    if (point.cape !== null && point.cape > 200) {
      score *= 1.05;
      multipliers.push({ label: 'CAPE', factor: 1.05 });
    }

    // Evening decay — thermals die after 17:00
    if (hour >= 17) {
      const decayFactor = hour >= 20 ? 0.15 : hour >= 19 ? 0.35 : hour >= 18 ? 0.6 : 0.85;
      score *= decayFactor;
      multipliers.push({ label: 'Atardecer', factor: decayFactor });
    }

    // Pressure trend — lower pressure favors convection
    if (point.pressure !== null) {
      if (point.pressure < 1010) { score *= 1.08; multipliers.push({ label: 'P baja', factor: 1.08 }); }
      else if (point.pressure < 1015) { score *= 1.04; multipliers.push({ label: 'P baja', factor: 1.04 }); }
      else if (point.pressure > 1025) { score *= 0.92; multipliers.push({ label: 'P alta', factor: 0.92 }); }
    }

    // Solar radiation boost — strong insolation heats ground → better thermals
    if (point.solarRadiation !== null) {
      if (point.solarRadiation > 700) { score *= 1.15; multipliers.push({ label: 'Sol fuerte', factor: 1.15 }); }
      else if (point.solarRadiation > 500) { score *= 1.08; multipliers.push({ label: 'Sol', factor: 1.08 }); }
      else if (point.solarRadiation < 200 && hour >= 10 && hour <= 16) { score *= 0.7; multipliers.push({ label: 'Sin sol', factor: 0.7 }); }
    }

    score = Math.min(100, Math.max(0, Math.round(score)));

    if (score > bestScore) {
      bestScore = score;
      bestRule = rule.name;
      bestBreakdown = {
        temperature: Math.round(bkTemp),
        timeOfDay: Math.round(bkTime),
        season: bkSeason,
        humidity: Math.round(bkHumidity),
        windDirection: bkDir,
        windSpeed: Math.round(bkSpeed),
        baseTotal,
        multipliers,
      };

      const isPrimaryRule = rule.id.startsWith('thermal_');
      const isPrecursorRule = rule.id.startsWith('precursor_');
      if (isPrimaryRule && score >= 50) isNavigable = true;
      if (isPrecursorRule && score >= 40) isPrecursor = true;
    }
  }

  return { score: bestScore, mainRule: bestRule, isNavigable, isPrecursor, breakdown: bestBreakdown };
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
