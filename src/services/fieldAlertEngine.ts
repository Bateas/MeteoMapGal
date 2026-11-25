/**
 * Field alert engine: frost, rain and hail from the forecast, fog from the readings. Pure, no store
 * dependencies. ET0, mildew and growing degree days went out with the V3
 * (they lit the conditions dot on 274-303 days of 360 and nobody could check them).
 */

import type { HourlyForecast } from '../types/forecast';
import type { NormalizedReading } from '../types/station';
import type { FrostAlert, RainAlert, FieldAlerts, AlertLevel } from '../types/campo';
import { getSunTimes } from './solarUtils';
import { analyzeFog } from './dewPointService';

// ── Frost detection ──────────────────────────────────────

/**
 * Check frost risk in the forecast window.
 * Frost is most likely on clear, calm nights: temp < 2°C, cloudCover < 30%, wind < 2 m/s.
 */
export function checkFrost(forecast: HourlyForecast[], center?: [number, number]): FrostAlert {
  const noAlert: FrostAlert = { level: 'none', minTemp: null, timeWindow: null, cloudCover: null, windSpeed: null };
  if (forecast.length === 0) return noAlert;

  // Focus on nighttime hours (sunset to sunrise+2h)
  const sun = getSunTimes(new Date(), center);
  const nightHours = forecast.filter((p) => {
    const h = p.time.getHours();
    // Rough night window: after sunset or before sunrise+2h
    return h >= sun.sunset.getHours() || h <= sun.sunrise.getHours() + 2;
  });

  if (nightHours.length === 0) return noAlert;

  // Find coldest point with frost conditions
  let coldest: HourlyForecast | null = null;
  let coldestTemp = 999;

  for (const p of nightHours) {
    if (p.temperature === null) continue;
    if (p.temperature < coldestTemp) {
      coldestTemp = p.temperature;
      coldest = p;
    }
  }

  if (!coldest || coldestTemp > 4) return noAlert;

  const cloud = coldest.cloudCover ?? 50;
  const wind = coldest.windSpeed ?? 0;

  // Clear skies + calm wind amplify frost risk
  const clearSky = cloud < 30;
  const calmWind = wind < 2;

  let level: AlertLevel = 'none';
  if (coldestTemp <= 0 && clearSky && calmWind) level = 'critico';
  else if (coldestTemp <= 0) level = 'alto';
  else if (coldestTemp <= 2 && clearSky && calmWind) level = 'alto';
  else if (coldestTemp <= 2) level = 'riesgo';
  else if (coldestTemp <= 4 && clearSky && calmWind) level = 'riesgo';

  if (level === 'none') return noAlert;

  // Build time window around coldest point (±2h)
  const from = new Date(coldest.time.getTime() - 2 * 60 * 60 * 1000);
  const to = new Date(coldest.time.getTime() + 2 * 60 * 60 * 1000);

  return { level, minTemp: coldestTemp, timeWindow: { from, to }, cloudCover: cloud, windSpeed: wind };
}

// ── Rain / hail detection ────────────────────────────────

/**
 * Check rain and hail risk in the forecast window.
 * Hail: CAPE > 1000 + heavy precipitation.
 *
 * Uses TWO time windows:
 * - Imminent (0-3h): lower thresholds, more aggressive alerts
 * - Extended (3-12h): higher thresholds, only alerts for heavy rain or hail
 *
 * Beyond 12h: no alerts (too uncertain for actionable info).
 */
/**
 * Rain level of a block of forecast hours on its own, for the 48 h timeline: the imminent rules of
 * checkRainHail (hail -> critico; > 10 mm or > 2 mm with > 70 % -> alto; > 1 mm or > 70 % -> riesgo)
 * applied to those hours, whenever they fall. checkRainHail measures from NOW and ignores what lies
 * beyond 12 h, so the timeline fed one 3-hour block at a time to it could never show rain past 12 h.
 */
export function rainLevelForHours(hours: HourlyForecast[]): AlertLevel {
  let maxPrecip = 0, maxProb = 0, hail = false;
  for (const p of hours) {
    const precip = p.precipitation ?? 0;
    maxPrecip = Math.max(maxPrecip, precip);
    maxProb = Math.max(maxProb, p.precipProbability ?? 0);
    if ((p.cape ?? 0) > 1000 && precip > 5) hail = true;
  }
  if (hail) return 'critico';
  if (maxPrecip > 10 || (maxPrecip > 2 && maxProb > 70)) return 'alto';
  if (maxPrecip > 1 || maxProb > 70) return 'riesgo';
  return 'none';
}

export function checkRainHail(forecast: HourlyForecast[]): RainAlert {
  const noAlert: RainAlert = {
    level: 'none', maxPrecip: 0, maxProbability: 0, rainAccum6h: 0,
    hailRisk: false, firstRainAt: null, hoursUntilRain: null,
  };
  if (forecast.length === 0) return noAlert;

  const now = Date.now();
  const THREE_H = 3 * 60 * 60 * 1000;
  const SIX_H = 6 * 60 * 60 * 1000;
  const TWELVE_H = 12 * 60 * 60 * 1000;

  let maxPrecip = 0;
  let maxProb = 0;
  let hailRisk = false;
  let firstRainAt: Date | null = null;
  let rainAccum6h = 0;

  // Imminent window (0-3h): even light rain counts
  let imminentMaxPrecip = 0;
  let imminentMaxProb = 0;
  let imminentHail = false;

  // Extended window (3-12h): only significant rain
  let extendedMaxPrecip = 0;
  let extendedMaxProb = 0;
  let extendedHail = false;

  for (const p of forecast) {
    const elapsed = p.time.getTime() - now;
    if (elapsed < 0) continue; // skip past hours

    const precip = p.precipitation ?? 0;
    const prob = p.precipProbability ?? 0;
    const cape = p.cape ?? 0;
    const isHail = cape > 1000 && precip > 5;

    // Track first significant rain (>0.5mm AND >50% probability)
    if (!firstRainAt && precip > 0.5 && prob > 50 && elapsed <= TWELVE_H) {
      firstRainAt = p.time;
    }

    // 6-hour accumulation
    if (elapsed <= SIX_H) {
      rainAccum6h += precip;
    }

    // Global maximums (for display)
    if (elapsed <= TWELVE_H) {
      if (precip > maxPrecip) maxPrecip = precip;
      if (prob > maxProb) maxProb = prob;
      if (isHail) hailRisk = true;
    }

    // Window-specific tracking
    if (elapsed <= THREE_H) {
      if (precip > imminentMaxPrecip) imminentMaxPrecip = precip;
      if (prob > imminentMaxProb) imminentMaxProb = prob;
      if (isHail) imminentHail = true;
    } else if (elapsed <= TWELVE_H) {
      if (precip > extendedMaxPrecip) extendedMaxPrecip = precip;
      if (prob > extendedMaxProb) extendedMaxProb = prob;
      if (isHail) extendedHail = true;
    }
  }

  rainAccum6h = Math.round(rainAccum6h * 10) / 10;

  const hoursUntilRain = firstRainAt
    ? Math.round((firstRainAt.getTime() - now) / (60 * 60 * 1000) * 10) / 10
    : null;

  // ── Level determination: imminent takes priority ──
  let level: AlertLevel = 'none';

  // Imminent (0-3h): actionable, lower thresholds
  if (imminentHail) {
    level = 'critico';
  } else if (imminentMaxPrecip > 10 || (imminentMaxPrecip > 2 && imminentMaxProb > 70)) {
    level = 'alto';
  } else if (imminentMaxPrecip > 1 || imminentMaxProb > 70) {
    level = 'riesgo';
  }

  // Extended (3-12h): only upgrade if no imminent alert, and only for heavy rain/hail
  if (level === 'none') {
    if (extendedHail) {
      level = 'alto'; // hail in 3-12h = alto (not critico — still time)
    } else if (extendedMaxPrecip > 10 && extendedMaxProb > 70) {
      level = 'alto'; // heavy rain confirmed
    } else if (extendedMaxPrecip > 5 && extendedMaxProb > 60) {
      level = 'riesgo'; // moderate rain likely
    }
    // Light rain in 3-12h with just high prob → NO alert (too uncertain, too far)
  }

  return {
    level, maxPrecip, maxProbability: maxProb, rainAccum6h,
    hailRisk, firstRainAt, hoursUntilRain,
  };
}

// ── Combined check ───────────────────────────────────────

/**
 * Run all field alert checks.
 * @param forecast - hourly forecast data (from Open-Meteo)
 * @param readingHistory - real station readings (from weatherStore) for dew point/fog analysis
 * @param currentReadings - latest readings per station
 */
export function checkAllFieldAlerts(
  forecast: HourlyForecast[],
  readingHistory?: Map<string, NormalizedReading[]>,
  currentReadings?: Map<string, NormalizedReading>,
  center?: [number, number],
): FieldAlerts {
  const frost = checkFrost(forecast, center);
  const rain = checkRainHail(forecast);
  const fog = analyzeFog(readingHistory ?? new Map(), new Date(), forecast, currentReadings);

  return { frost, rain, fog };
}
