/**
 * Forecast vs Observation Delta Service
 *
 * Compares current station observations against the forecast for the same hour.
 * Shows the user whether conditions are evolving faster/slower than predicted.
 *
 * "Previsión decía 8kt, estación mide 14kt" → Δ+6kt
 *
 * Pure service — no React, no stores. Receives data, returns deltas.
 */

import type { HourlyForecast } from '../types/forecast';
import type { NormalizedReading } from '../types/station';
import { msToKnots } from './windUtils';

// ── Types ────────────────────────────────────────────────────

export interface ForecastDelta {
  /** Wind speed delta in knots (positive = stronger than forecast) */
  windDeltaKt: number | null;
  /** Temperature delta in °C (positive = warmer than forecast) */
  tempDelta: number | null;
  /** Humidity delta in % (positive = more humid than forecast) */
  humidityDelta: number | null;
  /** Forecast hour used for comparison (for tooltip) */
  forecastTime: Date;
  /** Minutes between reading and forecast hour (>60 = stale) */
  alignmentMinutes: number;
}

// ── Max alignment gap: don't compare if reading is >90 min from forecast hour ──
const MAX_ALIGNMENT_MIN = 90;

// ── Core functions ───────────────────────────────────────────

/**
 * Find the forecast hour closest to a target time.
 * Returns null if no forecast within MAX_ALIGNMENT_MIN.
 */
export function findNearestForecastHour(
  forecast: HourlyForecast[],
  targetTime: Date,
): HourlyForecast | null {
  if (forecast.length === 0) return null;

  const targetMs = targetTime.getTime();
  let best: HourlyForecast | null = null;
  let bestDiff = Infinity;

  for (const f of forecast) {
    const diff = Math.abs(f.time.getTime() - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = f;
    }
  }

  // Only valid if within alignment window
  if (bestDiff > MAX_ALIGNMENT_MIN * 60_000) return null;
  return best;
}

/**
 * Compute delta between a station reading and the forecast for that hour.
 * Returns null values for fields where either side is missing.
 */
export function computeDelta(
  reading: NormalizedReading,
  fcst: HourlyForecast,
): ForecastDelta {
  const alignmentMinutes = Math.abs(
    reading.timestamp.getTime() - fcst.time.getTime(),
  ) / 60_000;

  // Wind: convert both from m/s to kt, then delta
  let windDeltaKt: number | null = null;
  if (reading.windSpeed != null && fcst.windSpeed != null) {
    windDeltaKt = msToKnots(reading.windSpeed) - msToKnots(fcst.windSpeed);
  }

  // Temperature: both in °C
  let tempDelta: number | null = null;
  if (reading.temperature != null && fcst.temperature != null) {
    tempDelta = reading.temperature - fcst.temperature;
  }

  // Humidity: both in %
  let humidityDelta: number | null = null;
  if (reading.humidity != null && fcst.humidity != null) {
    humidityDelta = reading.humidity - fcst.humidity;
  }

  return {
    windDeltaKt,
    tempDelta,
    humidityDelta,
    forecastTime: fcst.time,
    alignmentMinutes,
  };
}

/**
 * Compute deltas for all stations with current readings.
 * Returns Map<stationId, ForecastDelta>.
 */
export function computeAllDeltas(
  forecast: HourlyForecast[],
  currentReadings: Map<string, NormalizedReading>,
): Map<string, ForecastDelta> {
  const deltas = new Map<string, ForecastDelta>();
  if (forecast.length === 0) return deltas;

  for (const [stationId, reading] of currentReadings) {
    const fcst = findNearestForecastHour(forecast, reading.timestamp);
    if (!fcst) continue;
    deltas.set(stationId, computeDelta(reading, fcst));
  }

  return deltas;
}

// ── Formatting helpers ───────────────────────────────────────

/**
 * Format a delta value with sign and color class.
 * Returns null if delta is too small to display.
 */
export function formatWindDelta(deltaKt: number | null): {
  text: string;
  color: string;
  title: string;
} | null {
  if (deltaKt == null) return null;
  const rounded = Math.round(deltaKt);
  if (rounded === 0) return null; // no meaningful difference

  const sign = rounded > 0 ? '+' : '';
  const text = `${sign}${rounded}`;

  // Green = stronger than forecast (good for sailing)
  // Red = weaker than forecast (disappointing)
  // Amber = small difference
  let color: string;
  if (Math.abs(rounded) <= 2) {
    color = 'text-slate-500'; // within noise margin
  } else if (rounded > 0) {
    color = rounded > 5 ? 'text-emerald-400' : 'text-emerald-500/70';
  } else {
    color = rounded < -5 ? 'text-red-400' : 'text-red-400/70';
  }

  const direction = rounded > 0 ? 'más fuerte' : 'más flojo';
  const title = `Previsión: ${Math.round(msToKnots(0) + Math.abs(deltaKt))}kt → Δ${sign}${rounded}kt (${direction} que la previsión)`;

  return { text, color, title };
}

export function formatTempDelta(delta: number | null): {
  text: string;
  color: string;
  title: string;
} | null {
  if (delta == null) return null;
  const rounded = Math.round(delta * 10) / 10;
  if (Math.abs(rounded) < 0.5) return null;

  const sign = rounded > 0 ? '+' : '';
  const text = `${sign}${rounded.toFixed(1)}°`;

  let color: string;
  if (Math.abs(rounded) <= 1) {
    color = 'text-slate-500';
  } else if (rounded > 0) {
    color = 'text-orange-400/80';
  } else {
    color = 'text-cyan-400/80';
  }

  const direction = rounded > 0 ? 'más cálido' : 'más frío';
  const title = `Δ${sign}${rounded.toFixed(1)}°C vs previsión (${direction})`;

  return { text, color, title };
}
