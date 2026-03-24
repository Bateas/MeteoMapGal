/**
 * Bocana (terral/land breeze) detection for Rías Baixas.
 *
 * Validates with 14 days of buoy data (March 2026):
 *   - 8/13 days: Marín morning NE/E (30-140°) → afternoon SW (200-270°)
 *   - Rande ΔT (water-air) > +1.5°C correlates with bocana
 *   - Buoys: 5-17kt while land stations: 0-3kt
 *   - Peak season: April-May (13% of mornings)
 *   - Killed by clouds/rain (no solar motor)
 *
 * Pattern: overnight cooling → cold land air drains toward warmer sea
 *          → E/NE wind on water surface 6-11 AM
 *          → stops when sun heats land (reverses to sea breeze)
 *
 * Open-Meteo Archive does NOT capture bocana (10km grid too coarse).
 * Only real buoy data detects it.
 */

import type { BuoyReading } from '../api/buoyClient';

// ── Types ────────────────────────────────────────────

export interface BocanaSignal {
  /** Whether bocana conditions are detected */
  active: boolean;
  /** Confidence 0-100% */
  confidence: number;
  /** Wind boost to apply (kt) */
  boostKt: number;
  /** Human-readable signal description */
  signal: string | null;
  /** Rande water-air delta */
  deltaT: number | null;
  /** Buoy wind that confirms bocana */
  buoyWindKt: number | null;
  /** Buoy wind direction */
  buoyDir: number | null;
}

// ── Constants ────────────────────────────────────────

/** Bocana only happens in the morning (solar hours) */
const BOCANA_START_HOUR = 6;
const BOCANA_END_HOUR = 11;

/** Rande buoy station ID (has humidity/temp, no wind) */
const RANDE_ID = 1251;

/** Buoys that measure wind in/near Ría de Vigo */
const WIND_BUOY_IDS = new Set([3221, 3223]); // Vigo + Marín REDMAR

/** Bocana direction range: NE to ESE (land → sea) */
const BOCANA_DIR_MIN = 20;
const BOCANA_DIR_MAX = 140;

/** Minimum wind on buoy to confirm bocana */
const MIN_BUOY_WIND_MS = 2.0; // ~4kt

/** Minimum water-air temperature differential */
const MIN_DELTA_T = 1.5; // °C

/** Minimum Rande humidity for bocana */
const MIN_HUMIDITY = 65;

/** Solar radiation threshold — if available, confirms clear sky */
const MIN_SOLAR_RAD = 100; // W/m² (early morning value, lower than midday)

// ── Detector ─────────────────────────────────────────

/**
 * Detect bocana (morning terral) from buoy data.
 *
 * @param buoys - All available buoy readings
 * @param solarRad - Current solar radiation from nearest station (W/m²), null if unavailable
 * @param hour - Current hour (0-23), defaults to now
 * @returns BocanaSignal with detection result
 */
export function detectBocana(
  buoys: BuoyReading[],
  solarRad: number | null = null,
  hour?: number,
): BocanaSignal {
  const currentHour = hour ?? new Date().getHours();
  const noSignal: BocanaSignal = {
    active: false, confidence: 0, boostKt: 0,
    signal: null, deltaT: null, buoyWindKt: null, buoyDir: null,
  };

  // ── Time gate: only 6-11 AM ────────────────────────
  if (currentHour < BOCANA_START_HOUR || currentHour > BOCANA_END_HOUR) {
    return noSignal;
  }

  // ── Find Rande buoy (temperature + humidity) ───────
  const rande = buoys.find(b => b.stationId === RANDE_ID);
  if (!rande) return noSignal;

  const waterTemp = rande.waterTemp;
  const airTemp = rande.airTemp;
  const humidity = rande.humidity;

  // Need both temps to compute differential
  if (waterTemp == null || airTemp == null) return noSignal;

  const deltaT = waterTemp - airTemp;

  // ── ΔT check: water must be warmer than air ────────
  if (deltaT < MIN_DELTA_T) return noSignal;

  // ── Humidity check ─────────────────────────────────
  if (humidity != null && humidity < MIN_HUMIDITY) return noSignal;

  // ── Find wind buoy confirming E/NE direction ───────
  let bestBuoyWind = 0;
  let bestBuoyDir: number | null = null;
  let buoyConfirmed = false;

  for (const b of buoys) {
    if (!WIND_BUOY_IDS.has(b.stationId)) continue;
    if (b.windSpeed == null || b.windDir == null) continue;

    const dir = b.windDir;
    const isBocanaDir = dir >= BOCANA_DIR_MIN && dir <= BOCANA_DIR_MAX;

    if (isBocanaDir && b.windSpeed > bestBuoyWind) {
      bestBuoyWind = b.windSpeed;
      bestBuoyDir = dir;
      buoyConfirmed = b.windSpeed >= MIN_BUOY_WIND_MS;
    }
  }

  // ── Compute confidence ─────────────────────────────
  let confidence = 0;

  // ΔT contribution (30%): +1.5° = 15%, +3° = 30%
  const deltaTScore = Math.min(deltaT / 3, 1) * 30;
  confidence += deltaTScore;

  // Humidity contribution (20%): 65% = 10%, 85%+ = 20%
  if (humidity != null) {
    const humScore = Math.min((humidity - 60) / 25, 1) * 20;
    confidence += Math.max(humScore, 0);
  }

  // Buoy wind confirmation (35%): 4kt = 17%, 8kt+ = 35%
  if (buoyConfirmed && bestBuoyDir != null) {
    const buoyKt = bestBuoyWind * 1.94384;
    const buoyScore = Math.min(buoyKt / 8, 1) * 35;
    confidence += buoyScore;
  }

  // Solar/cloud check (15%): clear sky boosts confidence
  if (solarRad != null) {
    if (solarRad >= MIN_SOLAR_RAD) {
      confidence += 15; // Clear sky confirmed
    } else if (solarRad < 50 && currentHour >= 8) {
      // Cloudy after 8AM = no thermal motor
      confidence = Math.min(confidence, 30);
    }
  } else {
    // No solar data — give half credit (assume possible)
    confidence += 7;
  }

  confidence = Math.round(Math.min(confidence, 100));

  // ── Threshold: need >40% confidence to activate ────
  if (confidence < 40) return noSignal;

  // ── Compute boost ──────────────────────────────────
  // Buoy-confirmed: use buoy wind as basis (capped at 8kt boost)
  // Not buoy-confirmed: estimate from ΔT (conservative 3-5kt)
  let boostKt: number;
  const buoyKt = bestBuoyWind * 1.94384;

  if (buoyConfirmed) {
    // Buoy is measuring the real wind — use it minus land consensus
    // Land shows ~1-3kt, buoy shows 5-17kt → boost = buoy - 2kt (conservative)
    boostKt = Math.min(buoyKt - 2, 8);
  } else {
    // No buoy confirmation — conservative estimate from ΔT
    boostKt = deltaT >= 3 ? 4 : 3;
  }
  boostKt = Math.max(boostKt, 2);

  // ── Build signal description ───────────────────────
  const dirStr = bestBuoyDir != null ? `${Math.round(bestBuoyDir)}°` : 'E/NE';
  const signal = buoyConfirmed
    ? `Terral ${dirStr} detectado (${Math.round(buoyKt)}kt en boya, ΔT ${deltaT.toFixed(1)}°C)`
    : `Terral probable (ΔT ${deltaT.toFixed(1)}°C, hum ${humidity ?? '?'}%)`;

  return {
    active: true,
    confidence,
    boostKt,
    signal,
    deltaT,
    buoyWindKt: buoyConfirmed ? Math.round(buoyKt) : null,
    buoyDir: bestBuoyDir,
  };
}
