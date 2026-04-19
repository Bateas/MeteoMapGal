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

/** SW direction range — broader: includes S-SSE (160°) through WSW (280°) */
const SW_DIR_MIN = 160;
const SW_DIR_MAX = 280;

/** Minimum synoptic wind to trigger canalization (m/s) */
const MIN_SW_WIND_MS = 4.0; // ~8kt — lowered, A Guarda often reports 8-12kt SSE

/** Thermal breeze (afternoon SW pattern) thresholds */
const THERMAL_HOUR_MIN = 12;
const THERMAL_HOUR_MAX = 20;
const THERMAL_MIN_AIR_TEMP = 16; // °C — sun heats land
const THERMAL_MIN_DELTA_T = 2;   // °C land-sea differential

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
  /** Air temperature near Cesantes (°C) — for thermal breeze detection */
  airTempLocal: number | null = null,
  /** Water temperature (sea surface) — for ΔT thermal calculation */
  waterTemp: number | null = null,
  /** Highest local station wind reading (kt) — fallback when no synoptic */
  localStationKt: number | null = null,
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

  // Find mouth-of-ría buoy with SW wind (broader range)
  const mouthBuoys = buoys.filter((b) => MOUTH_BUOY_IDS.has(b.stationId));
  let synopticWindMs: number | null = null;
  let synopticDir: number | null = null;
  let sourceBuoy: string | null = null;

  for (const b of mouthBuoys) {
    if (b.windSpeed === null || b.windDir === null) continue;
    if (b.windSpeed < MIN_SW_WIND_MS) continue;
    if (b.windDir < SW_DIR_MIN || b.windDir > SW_DIR_MAX) continue;
    if (synopticWindMs === null || b.windSpeed > synopticWindMs) {
      synopticWindMs = b.windSpeed;
      synopticDir = b.windDir;
      sourceBuoy = b.stationName;
    }
  }

  // ── MODE 2: Thermal breeze (afternoon SW pattern, no strong synoptic needed) ──
  // Classic Cesantes pattern Apr-Oct: sun heats land → low pressure inland → SW marine breeze
  // even when mouth buoys offline or no Atlantic synoptic SW.
  const hour = new Date().getHours();
  const isThermalHour = hour >= THERMAL_HOUR_MIN && hour <= THERMAL_HOUR_MAX;
  const isWarmAir = airTempLocal !== null && airTempLocal >= THERMAL_MIN_AIR_TEMP;
  const deltaT = (airTempLocal !== null && waterTemp !== null) ? airTempLocal - waterTemp : null;
  const isThermalDelta = deltaT !== null && deltaT >= THERMAL_MIN_DELTA_T;

  if (synopticWindMs === null) {
    // No synoptic SW found — try thermal breeze mode
    if (!isThermalHour || !isWarmAir || !isThermalDelta) {
      return inactive;
    }
    // Use local station wind (or default 6kt if not provided) — thermal breeze adds local boost
    const baseKt = localStationKt ?? 6;
    const thermalBoostKt = Math.min(8, deltaT * 2); // +2kt per °C of land-sea ΔT, max +8kt
    const predictedKt = baseKt + thermalBoostKt;
    if (predictedKt < 10) return inactive;
    return {
      active: true,
      confidence: 70,
      predictedKt: Math.round(predictedKt),
      predictedDir: 230, // Typical SW thermal breeze
      boostFactor: predictedKt / Math.max(baseKt, 1),
      signals: [
        `Brisa térmica vespertina (${hour}h, aire ${airTempLocal!.toFixed(0)}°C, ΔT +${deltaT.toFixed(1)}°C)`,
        `Estaciones cercanas leen ${baseKt.toFixed(0)}kt — Cesantes acelerada por canalización local`,
      ],
      severity: predictedKt >= 15 ? 'high' : 'moderate',
    };
  }

  // ── MODE 1: Synoptic SW canalization (Atlantic wind) ──
  const signals: string[] = [];
  signals.push(`SW sinóptico ${(synopticWindMs * 1.944).toFixed(0)}kt en ${sourceBuoy}`);

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

  // Thermal breeze ENHANCES synoptic SW in afternoon (additive boost)
  if (isThermalHour && isWarmAir && isThermalDelta) {
    boostFactor += 0.3;
    confidence += 10;
    signals.push(`+ Brisa térmica vespertina activa (aire ${airTempLocal!.toFixed(0)}°C ΔT +${deltaT!.toFixed(1)}°C)`);
  }

  boostFactor = Math.min(boostFactor, MAX_BOOST);

  const predictedMs = synopticWindMs * boostFactor;
  const predictedKt = predictedMs * 1.944;

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
