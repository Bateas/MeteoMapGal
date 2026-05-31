/**
 * Liméns Channeling Predictor — N/NNW orographic wind boost (Cangas).
 *
 * Pattern (observed by user, S136+3+7):
 *   Praia de Liméns sits in a gap between hills on the south shore of the
 *   outer Ría de Vigo. When the Cabo Udra buoy (to the N) reads N/NNW —
 *   i.e. the flow lines up with the gap and points at the beach — the wind
 *   is CHANNELED and accelerates a bit at Liméns: the buoy shows ~12 kt but
 *   the beach runs an easy 15+.
 *
 * Small, conditional boost (only in the N/NNW sector). W and E do NOT reach
 * Liméns, and there's no thermal viración here, so this is the only local
 * correction. Reuses the CesantesPrediction shape so the scoring engine's
 * existing channeling-override path applies it unchanged.
 *
 * BETA — boost magnitude is a first estimate from the user's read; refine
 * against the buoy once we have logged sessions.
 */

import type { BuoyReading } from '../api/buoyClient';
import type { CesantesPrediction } from './cesantesCanalizationDetector';

/** Cabo Udra REMPOR buoy — the N reference that aligns with the Liméns gap. */
const CABO_UDRA_BUOY_ID = 4273;

/** Channeling sector: NW → NNW → N → just past N (wraps through 0°). Floor at
 *  NW 300° because the user confirmed NW (300°) already channels and runs 15+
 *  ("y así"); W (270°) and E do NOT reach Liméns, so they stay out. */
const CHANNEL_DIR_MIN = 300; // NW
const CHANNEL_DIR_MAX = 10;  // just past N (wraps through 360)

/** Minimum buoy wind to bother boosting (m/s ≈ 8 kt). Below this it's light
 *  regardless and the channeling isn't meaningful. */
const MIN_WIND_MS = 4.1;

/** Small orographic acceleration — the user's read is ~12 kt buoy → ~15 kt
 *  beach (≈ +25%). Conservative; tune with logged data. */
const BOOST_FACTOR = 1.25;

/** Cap the predicted boost (sanity). */
const MAX_PREDICTED_KT = 35;

function inChannelSector(dir: number): boolean {
  // Sector wraps through 0° (320 → 360 → 10).
  return dir >= CHANNEL_DIR_MIN || dir <= CHANNEL_DIR_MAX;
}

/**
 * Predict the N/NNW channeling boost at Liméns from the Cabo Udra buoy.
 * Returns an inactive prediction unless the buoy shows aligned N/NNW wind.
 */
export function predictLimensChanneling(buoys: BuoyReading[]): CesantesPrediction {
  const inactive: CesantesPrediction = {
    active: false, confidence: 0, predictedKt: null, predictedDir: null,
    boostFactor: 1, signals: [], severity: 'info',
  };

  const udra = buoys.find((b) => b.stationId === CABO_UDRA_BUOY_ID);
  if (!udra || udra.windSpeed === null || udra.windDir === null) return inactive;
  if (udra.windSpeed < MIN_WIND_MS) return inactive;
  if (!inChannelSector(udra.windDir)) return inactive;

  const baseKt = udra.windSpeed * 1.944;
  const predictedKt = Math.min(MAX_PREDICTED_KT, Math.round(baseKt * BOOST_FACTOR));

  return {
    active: true,
    confidence: 70,
    predictedKt,
    predictedDir: udra.windDir,
    boostFactor: BOOST_FACTOR,
    signals: [
      `Cabo Udra ${baseKt.toFixed(0)}kt del N/NNW (${Math.round(udra.windDir)}°) — alineado con la canalización de Liméns`,
      `El monte acelera el flujo: la playa corre ~${predictedKt}kt (boya lee ${baseKt.toFixed(0)}kt)`,
    ],
    severity: predictedKt >= 18 ? 'high' : 'moderate',
  };
}
