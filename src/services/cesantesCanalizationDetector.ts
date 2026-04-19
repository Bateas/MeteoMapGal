/**
 * Cesantes Canalization Predictor — Ría de Vigo interior wind boost.
 *
 * Pattern (S122 — observed by user):
 *   - SW synoptic wind from Atlantic (Cabo Silleiro, Cíes >10kt)
 *   - Maritime fog in the mouth of the ría (Moaña HR>85%)
 *   - Air-water differential creates pressure gradient
 *   - Wind channels through Vigo ría and accelerates 1.5-2.5x in interior
 *   - Cesantes valley experiences 15-25kt local while stations 5-10km away show 5-12kt
 *
 * This is an UNMEASURED phenomenon — no weather station sits in Cesantes valley.
 * Required: physical model based on synoptic conditions + mouth-of-ría signals.
 *
 * Returns prediction for SAILORS to plan sessions: "Cesantes likely 18kt SW now/soon"
 */

import type { BuoyReading } from '../api/buoyClient';
import type { NormalizedStation, NormalizedReading } from '../types/station';

// ── Types ────────────────────────────────────────────────────

export interface CesantesPrediction {
  /** Active prediction or none */
  active: boolean;
  /** Confidence 0-100% */
  confidence: number;
  /** Predicted wind speed in Cesantes (kt) */
  predictedKt: number | null;
  /** Predicted wind direction (degrees) */
  predictedDir: number | null;
  /** Boost factor applied to synoptic wind */
  boostFactor: number;
  /** Human-readable signals contributing */
  signals: string[];
  /** Severity for alert */
  severity: 'info' | 'moderate' | 'high';
}

// ── Constants ────────────────────────────────────────────────

/** Mouth-of-ría buoys for synoptic SW wind detection */
const MOUTH_BUOY_IDS = new Set([2248, 1252, 1253]); // Cabo Silleiro, Cíes, A Guarda

/** SW direction range (Atlantic onshore) */
const SW_DIR_MIN = 200;
const SW_DIR_MAX = 270;

/** Minimum synoptic wind to trigger canalization (m/s) */
const MIN_SW_WIND_MS = 5.0; // ~10kt

/** Humidity threshold in mouth of ría (indicates moisture inflow) */
const HIGH_MOUTH_HUMIDITY = 85;

/** Canalization boost factors */
const BOOST_BASE = 1.4;       // SW wind alone → +40%
const BOOST_HUMID = 1.7;      // SW + high humidity in mouth → +70%
const BOOST_FOG = 2.0;        // SW + fog confirmed → +100% (rare alignment)

/** Max realistic boost cap (sanity) */
const MAX_BOOST = 2.5;

// ── Detector ─────────────────────────────────────────────────

/**
 * Predict Cesantes canalization conditions.
 *
 * @param buoys All Rías buoys (looks for mouth buoys)
 * @param mouthHumidity Average humidity from stations near mouth of Ría de Vigo (%)
 * @param webcamFogInMouth True if webcams in mouth area (Moaña, Cíes, Ons) detect fog
 */
export function predictCesantesCanalization(
  buoys: BuoyReading[],
  mouthHumidity: number | null,
  webcamFogInMouth: boolean = false,
): CesantesPrediction {
  const inactive: CesantesPrediction = {
    active: false,
    confidence: 0,
    predictedKt: null,
    predictedDir: null,
    boostFactor: 1,
    signals: [],
    severity: 'info',
  };

  // Find mouth-of-ría buoy with SW wind
  const mouthBuoys = buoys.filter((b) => MOUTH_BUOY_IDS.has(b.stationId));
  let synopticWindMs: number | null = null;
  let synopticDir: number | null = null;
  let sourceBuoy: string | null = null;

  for (const b of mouthBuoys) {
    if (b.windSpeed === null || b.windDir === null) continue;
    if (b.windSpeed < MIN_SW_WIND_MS) continue;
    if (b.windDir < SW_DIR_MIN || b.windDir > SW_DIR_MAX) continue;
    // Use strongest SW wind among mouth buoys
    if (synopticWindMs === null || b.windSpeed > synopticWindMs) {
      synopticWindMs = b.windSpeed;
      synopticDir = b.windDir;
      sourceBuoy = b.stationName;
    }
  }

  if (synopticWindMs === null || synopticDir === null) {
    return inactive;
  }

  const signals: string[] = [];
  signals.push(`SW sinóptico ${(synopticWindMs * 1.944).toFixed(0)}kt en ${sourceBuoy}`);

  // Determine boost factor
  let boostFactor = BOOST_BASE;
  let confidence = 50;
  let severity: 'info' | 'moderate' | 'high' = 'info';

  if (webcamFogInMouth) {
    boostFactor = BOOST_FOG;
    confidence = 85;
    severity = 'high';
    signals.push('Niebla en boca de ría (cámaras) — convergencia húmeda');
  } else if (mouthHumidity !== null && mouthHumidity >= HIGH_MOUTH_HUMIDITY) {
    boostFactor = BOOST_HUMID;
    confidence = 70;
    severity = 'moderate';
    signals.push(`HR ${mouthHumidity.toFixed(0)}% en boca — aire húmedo entrando`);
  } else {
    signals.push('Canalización SW estándar (sin convergencia húmeda)');
  }

  // Apply cap
  boostFactor = Math.min(boostFactor, MAX_BOOST);

  const predictedMs = synopticWindMs * boostFactor;
  const predictedKt = predictedMs * 1.944;

  // Only report if predicted wind is meaningfully sailable (>10kt)
  if (predictedKt < 10) return inactive;

  return {
    active: true,
    confidence,
    predictedKt: Math.round(predictedKt),
    predictedDir: synopticDir,
    boostFactor,
    signals,
    severity,
  };
}

/**
 * Helper to compute mouth-of-ría humidity from station readings.
 * Mouth = stations near Vigo bay entrance (lon < -8.78, lat 42.15-42.30).
 */
export function computeMouthHumidity(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
): number | null {
  const mouth: number[] = [];
  for (const s of stations) {
    // Mouth of Ría de Vigo bounding box
    if (s.lon > -8.78 || s.lat < 42.15 || s.lat > 42.30) continue;
    const r = readings.get(s.id);
    if (r?.humidity == null) continue;
    mouth.push(r.humidity);
  }
  if (mouth.length === 0) return null;
  // Use 75th percentile (robust to interior dry stations leaking in)
  const sorted = [...mouth].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75));
  return sorted[idx];
}
