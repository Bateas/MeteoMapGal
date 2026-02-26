/**
 * Humidity-Wind Cross-Validation Analyzer
 *
 * Problem: humidity sensors at weather stations are unreliable.
 * - They spike to 100% with fog/drizzle even when ambient is lower
 * - They drop very fast when sun hits directly
 * - Absolute values can be ±15% off between stations
 *
 * Solution: cross-validate humidity readings against wind patterns
 * and atmospheric context to estimate "effective humidity" for
 * thermal prediction.
 *
 * Key insights from AEMET analysis:
 * - HR media > 85% on thermal days: 0% thermal probability
 * - HR sweet spot for thermals: 45-65%
 * - When wind is W and temp > 28°C, humidity naturally drops → sensor reading
 *   should be 40-60%, not 80%+. If it reads 80%+, sensor is likely wet/foggy.
 * - When multiple stations disagree by >25%, the outlier is likely faulty.
 */

import type { NormalizedReading } from '../types/station';
import type { AtmosphericContext } from '../types/thermal';

export interface HumidityAssessment {
  /** Raw average humidity from sensors */
  rawAvg: number | null;
  /** Confidence-adjusted humidity estimate */
  adjustedAvg: number | null;
  /** How reliable the reading is (0-1) */
  confidence: number;
  /** Warning message if sensors seem off */
  warning: string | null;
  /** Individual station assessments */
  stationReliability: Map<string, { value: number; reliable: boolean; reason?: string }>;
}

/**
 * Analyze humidity readings for a zone, cross-validating between stations
 * and against atmospheric context.
 */
export function analyzeZoneHumidity(
  readings: NormalizedReading[],
  atmosphericContext: AtmosphericContext | null,
  currentTemp: number | null,
): HumidityAssessment {
  const humidityReadings = readings
    .filter((r) => r.humidity !== null)
    .map((r) => ({ stationId: r.stationId, humidity: r.humidity! }));

  if (humidityReadings.length === 0) {
    return {
      rawAvg: null,
      adjustedAvg: null,
      confidence: 0,
      warning: null,
      stationReliability: new Map(),
    };
  }

  const values = humidityReadings.map((r) => r.humidity);
  const rawAvg = values.reduce((a, b) => a + b, 0) / values.length;
  const stationReliability = new Map<string, { value: number; reliable: boolean; reason?: string }>();

  // ── Station cross-validation ────────────────────────────
  // If stations disagree by >25%, flag outliers
  const median = sortedMedian(values);
  for (const r of humidityReadings) {
    const deviation = Math.abs(r.humidity - median);
    if (deviation > 25 && humidityReadings.length >= 2) {
      stationReliability.set(r.stationId, {
        value: r.humidity,
        reliable: false,
        reason: `Desv. ${deviation.toFixed(0)}% vs mediana (${median.toFixed(0)}%)`,
      });
    } else {
      stationReliability.set(r.stationId, {
        value: r.humidity,
        reliable: true,
      });
    }
  }

  // ── Atmospheric cross-check ─────────────────────────────
  // If Open-Meteo shows clear sky + strong radiation, but stations report
  // humidity >85%, the sensors are likely fogged or wet.
  let adjustedAvg = rawAvg;
  let confidence = 0.7; // Base confidence for humidity sensors
  let warning: string | null = null;

  if (atmosphericContext) {
    const { cloudCover, solarRadiation } = atmosphericContext;

    // Clear sky + high radiation + high temp = humidity should be lower
    if (cloudCover !== null && cloudCover < 20 &&
        solarRadiation !== null && solarRadiation > 400 &&
        currentTemp !== null && currentTemp > 25) {
      if (rawAvg > 80) {
        // Sensors reading high humidity under clear skies — likely sensor error
        warning = `HR ${rawAvg.toFixed(0)}% con cielo despejado (${cloudCover}% nubes) y ${solarRadiation.toFixed(0)} W/m² rad. — sensores probablemente mojados`;
        confidence = 0.3;
        // Estimate: under these conditions, humidity should be 50-65%
        adjustedAvg = Math.min(rawAvg, 65);
      } else {
        // Clear sky, sensors showing reasonable values → higher confidence
        confidence = 0.9;
      }
    }

    // Overcast (>80% cloud) typically means higher humidity → trust sensors more
    if (cloudCover !== null && cloudCover > 80) {
      confidence = Math.min(confidence + 0.1, 1.0);
    }
  }

  // ── Temperature-humidity consistency ─────────────────────
  // At T>32°C, humidity below 30% is normal (dry heat).
  // At T>28°C with strong sun, HR>75% is suspicious.
  if (currentTemp !== null && currentTemp > 28 && rawAvg > 75) {
    if (!warning) {
      warning = `HR ${rawAvg.toFixed(0)}% alta para ${currentTemp.toFixed(0)}°C — posible error sensor`;
    }
    confidence = Math.min(confidence, 0.5);
  }

  // ── Multi-station agreement boost ───────────────────────
  if (humidityReadings.length >= 3) {
    const reliableCount = [...stationReliability.values()].filter((r) => r.reliable).length;
    if (reliableCount === humidityReadings.length) {
      // All stations agree → higher confidence
      confidence = Math.min(confidence + 0.15, 1.0);
    }

    // Use only reliable stations for adjusted average
    const reliableValues = humidityReadings
      .filter((r) => stationReliability.get(r.stationId)?.reliable)
      .map((r) => r.humidity);
    if (reliableValues.length > 0) {
      adjustedAvg = reliableValues.reduce((a, b) => a + b, 0) / reliableValues.length;
    }
  }

  return {
    rawAvg,
    adjustedAvg: Math.round(adjustedAvg * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    warning,
    stationReliability,
  };
}

function sortedMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
