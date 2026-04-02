/**
 * Inversion Forecast Service — predicts thermal inversions BEFORE they happen.
 *
 * Uses Open-Meteo hourly forecast to identify nighttime windows where
 * inversion conditions are likely:
 * 1. Clear skies (cloudCover < 20%) → strong radiative cooling in valleys
 * 2. Calm wind (< 5 kt / ~2.5 m/s) → no mixing to break inversion
 * 3. High delta-T (Tmax - Tmin > 15°C) → strong nocturnal cooling
 * 4. Evening/night timing (inversions form after sunset)
 * 5. Low PBL height (< 200m) → trapped air, shallow mixing layer
 *
 * Scoring: clearSky(0-25) + calmWind(0-25) + deltaT(0-20) + timing(0-15) + PBL(0-15) = max 100
 *
 * These are the classic conditions for radiation-type inversions
 * common in Ourense's valley geography.
 */

import type { HourlyForecast } from '../types/forecast';
import type { UnifiedAlert } from './alertService';

// ── Types ────────────────────────────────────────────────────

export interface InversionForecast {
  /** Is an inversion predicted? */
  predicted: boolean;
  /** Confidence in the prediction (0-100) */
  confidence: number;
  /** Expected start time (null if not predicted) */
  expectedStart: Date | null;
  /** Expected peak time (coldest valley point) */
  expectedPeak: Date | null;
  /** Forecasted conditions at peak */
  peakConditions: {
    cloudCover: number;
    windSpeed: number;
    temperature: number;
    humidity: number;
  } | null;
  /** Human-readable hypothesis (Spanish) */
  hypothesis: string;
  /** Score factors for debugging */
  factors: {
    clearSkyScore: number;    // 0-25
    calmWindScore: number;    // 0-25
    deltaTScore: number;      // 0-20
    timingScore: number;      // 0-15
    pblScore: number;         // 0-15
  };
}

// ── Constants ────────────────────────────────────────────────

/** Cloud cover threshold for clear skies (%) */
const CLEAR_SKY_THRESHOLD = 20;
/** Wind speed threshold for calm conditions (m/s) */
const CALM_WIND_THRESHOLD = 2.5;
/** Min ΔT (°C) to suggest strong nocturnal cooling */
const MIN_DELTA_T = 12;
/** Strong ΔT threshold */
const STRONG_DELTA_T = 18;

// ── Core analysis ────────────────────────────────────────────

/**
 * Analyze forecast data to predict overnight thermal inversions.
 *
 * Looks at the NEXT nighttime window (sunset → sunrise+2h)
 * and scores conditions for inversion formation.
 */
export function forecastInversion(forecast: HourlyForecast[]): InversionForecast {
  const noInversion: InversionForecast = {
    predicted: false,
    confidence: 0,
    expectedStart: null,
    expectedPeak: null,
    peakConditions: null,
    hypothesis: 'Sin condiciones de inversión previstas',
    factors: { clearSkyScore: 0, calmWindScore: 0, deltaTScore: 0, timingScore: 0, pblScore: 0 },
  };

  if (forecast.length < 12) return noInversion;

  const now = new Date();

  // Find next nighttime window: from current hour to next 18 hours
  // Night hours: 20:00 to 08:00 (local)
  const nightPoints = forecast.filter((p) => {
    const dt = p.time.getTime() - now.getTime();
    if (dt < -1_800_000 || dt > 18 * 3_600_000) return false; // next 18h only
    const h = p.time.getHours();
    return h >= 20 || h <= 8;
  });

  if (nightPoints.length < 3) return noInversion;

  // Calculate ΔT from today's full range
  const todayPoints = forecast.filter((p) => {
    const dt = p.time.getTime() - now.getTime();
    return dt >= -12 * 3_600_000 && dt <= 18 * 3_600_000;
  });

  const temps = todayPoints
    .map((p) => p.temperature)
    .filter((t): t is number => t !== null);

  const deltaT = temps.length >= 4
    ? Math.max(...temps) - Math.min(...temps)
    : null;

  // ── Score each factor ──────────────────────────────────

  // 1. Clear sky score (0-25): average cloud cover during night
  const cloudCovers = nightPoints
    .map((p) => p.cloudCover)
    .filter((c): c is number => c !== null);
  const avgCloud = cloudCovers.length > 0
    ? cloudCovers.reduce((a, b) => a + b, 0) / cloudCovers.length
    : 50;

  let clearSkyScore = 0;
  if (avgCloud <= 10) clearSkyScore = 25;
  else if (avgCloud <= CLEAR_SKY_THRESHOLD) clearSkyScore = 20;
  else if (avgCloud <= 35) clearSkyScore = 12;
  else if (avgCloud <= 50) clearSkyScore = 4;

  // 2. Calm wind score (0-25): average wind during night
  const winds = nightPoints
    .map((p) => p.windSpeed)
    .filter((w): w is number => w !== null);
  const avgWind = winds.length > 0
    ? winds.reduce((a, b) => a + b, 0) / winds.length
    : 3;

  let calmWindScore = 0;
  if (avgWind <= 1.0) calmWindScore = 25;
  else if (avgWind <= CALM_WIND_THRESHOLD) calmWindScore = 18;
  else if (avgWind <= 4.0) calmWindScore = 8;
  else if (avgWind <= 5.0) calmWindScore = 3;

  // 3. Delta-T score (0-20): bigger range = more cooling at night
  let deltaTScore = 0;
  if (deltaT !== null) {
    if (deltaT >= STRONG_DELTA_T) deltaTScore = 20;
    else if (deltaT >= MIN_DELTA_T) deltaTScore = 15;
    else if (deltaT >= 10) deltaTScore = 8;
    else if (deltaT >= 7) deltaTScore = 3;
  }

  // 4. Timing score (0-15): are we approaching or in the right window?
  const currentHour = now.getHours();
  let timingScore = 0;
  if (currentHour >= 17 && currentHour < 20) timingScore = 15; // Evening: warn early
  else if (currentHour >= 20 || currentHour < 2) timingScore = 14; // Night: forming now
  else if (currentHour >= 2 && currentHour < 6) timingScore = 12; // Deep night: peak
  else if (currentHour >= 14 && currentHour < 17) timingScore = 9; // Afternoon: heads-up
  else timingScore = 4; // Morning/midday: low relevance

  // 5. PBL height score (0-15): low boundary layer = trapped air = inversion
  const pblValues = nightPoints
    .map((p) => p.boundaryLayerHeight)
    .filter((v): v is number => v !== null);
  const avgPbl = pblValues.length > 0
    ? pblValues.reduce((a, b) => a + b, 0) / pblValues.length
    : null;

  let pblScore = 0;
  if (avgPbl !== null) {
    if (avgPbl < 100) pblScore = 15;       // Very shallow — strong trapping
    else if (avgPbl < 200) pblScore = 12;
    else if (avgPbl < 400) pblScore = 8;
    else if (avgPbl < 600) pblScore = 4;
    // >600m = well-mixed, no bonus
  }

  // ── Composite ─────────────────────────────────────────

  const totalScore = clearSkyScore + calmWindScore + deltaTScore + timingScore + pblScore;
  // Confidence: how reliable is the prediction
  const confidence = Math.min(100, Math.round(
    totalScore * (cloudCovers.length >= 6 ? 1.0 : 0.7),
  ));

  const predicted = totalScore >= 50;

  // Find the coldest night point (likely inversion peak)
  let coldestNight: HourlyForecast | null = null;
  let coldestTemp = 999;
  for (const p of nightPoints) {
    if (p.temperature !== null && p.temperature < coldestTemp) {
      coldestTemp = p.temperature;
      coldestNight = p;
    }
  }

  // Expected start: first night point with clear + calm conditions
  let expectedStart: Date | null = null;
  for (const p of nightPoints) {
    const clear = (p.cloudCover ?? 50) <= 30;
    const calm = (p.windSpeed ?? 5) <= 3;
    if (clear && calm) {
      expectedStart = p.time;
      break;
    }
  }

  // Build hypothesis
  const notes: string[] = [];
  if (predicted) {
    notes.push(`Inversión probable esta noche`);
    if (deltaT !== null) notes.push(`ΔT=${deltaT.toFixed(0)}°C`);
    notes.push(`nubes ${avgCloud.toFixed(0)}%`);
    notes.push(`viento ${avgWind.toFixed(1)} m/s`);
    if (coldestNight) {
      notes.push(`mín prevista ${coldestTemp.toFixed(1)}°C a las ${coldestNight.time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`);
    }
  } else if (totalScore >= 35) {
    notes.push('Condiciones marginales para inversión');
    if (avgCloud > CLEAR_SKY_THRESHOLD) notes.push(`nubes ${avgCloud.toFixed(0)}% (alto)`);
    if (avgWind > CALM_WIND_THRESHOLD) notes.push(`viento ${avgWind.toFixed(1)} m/s (alto)`);
  } else {
    notes.push('Sin condiciones de inversión previstas');
  }

  return {
    predicted,
    confidence,
    expectedStart: predicted ? expectedStart : null,
    expectedPeak: predicted && coldestNight ? coldestNight.time : null,
    peakConditions: predicted && coldestNight ? {
      cloudCover: coldestNight.cloudCover ?? avgCloud,
      windSpeed: coldestNight.windSpeed ?? avgWind,
      temperature: coldestTemp,
      humidity: coldestNight.humidity ?? 80,
    } : null,
    hypothesis: notes.join(' · '),
    factors: { clearSkyScore, calmWindScore, deltaTScore, timingScore, pblScore },
  };
}

// ── Build UnifiedAlert ───────────────────────────────────────

export function buildInversionForecastAlert(
  forecast: HourlyForecast[],
): UnifiedAlert[] {
  const result = forecastInversion(forecast);
  if (!result.predicted) return [];

  const score = Math.min(100, Math.round(result.confidence * 0.8));
  const isHighConf = result.confidence >= 60;

  let detail = result.hypothesis;
  if (result.expectedStart) {
    const startStr = result.expectedStart.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    detail = `Desde ~${startStr} · ${detail}`;
  }

  // Score-based severity, capped at moderate (yellow) — inversions are notable, not dangerous
  const severity = score >= 45 ? 'moderate' as const : 'info' as const;

  return [{
    id: 'inversion-forecast',
    category: 'inversion',
    severity,
    score,
    icon: 'thermometer',
    title: isHighConf ? 'Inversión prevista esta noche' : 'Posible inversión nocturna',
    detail,
    urgent: false,
    updatedAt: new Date(),
  }];
}
