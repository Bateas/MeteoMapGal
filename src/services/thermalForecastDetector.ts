/**
 * Thermal Forecast Detector — Early warning for epic sailing days.
 *
 * Crosses Open-Meteo forecast (12-48h ahead) with real-time conditions
 * to predict thermal wind events BEFORE they happen.
 *
 * Sources validated:
 * - PhD Montero (1999): upwelling + solar heating = thermal engine
 * - Foro La Taberna del Puerto: 20 Aug 2011, T>30C + HR<45% = 30kt event
 * - 3-year Open-Meteo analysis: 96% WSW events preceded by humidity >65%
 * - nicobm115/monitor: theta-v gradient approach
 *
 * BETA: estimates will be calibrated with real DB data (April-May 2026).
 */

import type { HourlyForecast } from '../types/forecast';

// ── Types ──────────────────────────────────────────

export interface ThermalForecastSignal {
  /** When the thermal window is predicted */
  label: string;
  /** Estimated start hour (local) */
  startHour: number;
  /** Estimated end hour (local) */
  endHour: number;
  /** Peak temperature forecast */
  peakTempC: number;
  /** Min humidity forecast during window */
  minHumidity: number;
  /** Max wind forecast during window (kt) */
  maxWindKt: number;
  /** Cloud cover during window (%) */
  avgCloudCover: number;
  /** Confidence: signals counted (0-5) */
  confidence: 'alta' | 'media' | 'baja';
  /** Number of matching signals */
  signalCount: number;
  /** Is this for today or tomorrow? */
  day: 'hoy' | 'manana';
}

// ── Constants ──────────────────────────────────────

const MS_TO_KT = 1.94384;
const THERMAL_WINDOW_START = 11; // Earliest thermal onset
const THERMAL_WINDOW_END = 19;   // Latest thermal activity

// Thresholds (from historical analysis + documented events)
const TEMP_EPIC = 30;      // Epic day threshold (2011 event: 32.6C)
const TEMP_GOOD = 25;      // Good thermal potential
const TEMP_MIN = 20;       // Minimum for any thermal activity
const HR_DRY = 45;         // Very dry = strong thermal (2011: 40%)
const HR_MODERATE = 55;    // Moderate dryness
const HR_MAX = 70;         // Too humid for strong thermal (unless bruma pattern)
const WIND_CALM = 3;       // m/s — calm enough for thermal to develop
const CLOUD_CLEAR = 30;    // % — clear enough for solar heating
const CLOUD_OK = 50;       // % — partially clear, still possible

// ── Core Analysis ──────────────────────────────────

/**
 * Analyze forecast data to detect upcoming thermal wind events.
 * Returns signals for today (remaining hours) and tomorrow.
 */
export function detectThermalForecast(
  forecast: HourlyForecast[],
): ThermalForecastSignal[] {
  if (!forecast || forecast.length === 0) return [];

  const now = new Date();
  const todayDate = now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = tomorrow.toDateString();

  const results: ThermalForecastSignal[] = [];

  // Group forecast by day
  const todayHours = forecast.filter(h =>
    h.time.toDateString() === todayDate &&
    h.time.getHours() >= THERMAL_WINDOW_START &&
    h.time.getHours() <= THERMAL_WINDOW_END
  );

  const tomorrowHours = forecast.filter(h =>
    h.time.toDateString() === tomorrowDate &&
    h.time.getHours() >= THERMAL_WINDOW_START &&
    h.time.getHours() <= THERMAL_WINDOW_END
  );

  // Analyze today (only future hours)
  const currentHour = now.getHours();
  const todayFuture = todayHours.filter(h => h.time.getHours() > currentHour);
  if (todayFuture.length >= 2) {
    const signal = analyzeWindow(todayFuture, 'hoy');
    if (signal) results.push(signal);
  }

  // Analyze tomorrow
  if (tomorrowHours.length >= 3) {
    const signal = analyzeWindow(tomorrowHours, 'manana');
    if (signal) results.push(signal);
  }

  return results;
}

function analyzeWindow(
  hours: HourlyForecast[],
  day: 'hoy' | 'manana',
): ThermalForecastSignal | null {
  // Extract peak values from the thermal window
  let peakTemp = -999;
  let minHumidity = 999;
  let maxWindMs = 0;
  let cloudSum = 0;
  let cloudCount = 0;
  let calmHours = 0;
  let startHour = 99;
  let endHour = 0;

  for (const h of hours) {
    const hr = h.time.getHours();
    if (h.temperature !== null && h.temperature > peakTemp) peakTemp = h.temperature;
    if (h.humidity !== null && h.humidity < minHumidity) minHumidity = h.humidity;
    if (h.windSpeed !== null && h.windSpeed > maxWindMs) maxWindMs = h.windSpeed;
    if (h.cloudCover !== null) { cloudSum += h.cloudCover; cloudCount++; }

    // Count calm hours (wind < 3 m/s = thermal can develop)
    if (h.windSpeed !== null && h.windSpeed < WIND_CALM) calmHours++;

    if (hr < startHour) startHour = hr;
    if (hr > endHour) endHour = hr;
  }

  const avgCloud = cloudCount > 0 ? cloudSum / cloudCount : 50;
  const maxWindKt = Math.round(maxWindMs * MS_TO_KT);

  // ── Signal counting ──────────────────────────────
  let signals = 0;

  // Temperature signals
  if (peakTemp >= TEMP_EPIC) signals += 2;       // Epic: double signal
  else if (peakTemp >= TEMP_GOOD) signals += 1;  // Good
  // Below TEMP_MIN = no thermal, bail
  if (peakTemp < TEMP_MIN) return null;

  // Humidity signals
  if (minHumidity <= HR_DRY) signals += 2;       // Very dry: double signal
  else if (minHumidity <= HR_MODERATE) signals += 1;
  // Too humid and no bruma pattern = weak
  if (minHumidity > HR_MAX) signals -= 1;

  // Cloud cover signal
  if (avgCloud <= CLOUD_CLEAR) signals += 1;     // Clear sky
  else if (avgCloud > CLOUD_OK) signals -= 1;    // Too cloudy

  // Calm conditions signal (thermal needs calm to build)
  if (calmHours >= hours.length * 0.5) signals += 1; // 50%+ hours calm

  // Minimum threshold: need at least 2 signals to report
  if (signals < 2) return null;

  // ── Build label ──────────────────────────────────
  const confidence = signals >= 5 ? 'alta' : signals >= 3 ? 'media' : 'baja';

  let label: string;
  if (signals >= 5 && peakTemp >= TEMP_EPIC) {
    label = day === 'hoy'
      ? `Día épico: ${peakTemp.toFixed(0)}C HR ${minHumidity.toFixed(0)}% - viento fuerte ${startHour}-${endHour}h`
      : `Mañana dia epico: ${peakTemp.toFixed(0)}C HR ${minHumidity.toFixed(0)}% - viento fuerte previsto`;
  } else if (signals >= 3) {
    label = day === 'hoy'
      ? `Viento probable ${startHour}-${endHour}h (${peakTemp.toFixed(0)}C, HR ${minHumidity.toFixed(0)}%)`
      : `Mañana: viento probable (${peakTemp.toFixed(0)}C, HR ${minHumidity.toFixed(0)}%)`;
  } else {
    label = day === 'hoy'
      ? `Condiciones favorables ${startHour}-${endHour}h (${peakTemp.toFixed(0)}C)`
      : `Mañana: condiciones favorables (${peakTemp.toFixed(0)}C)`;
  }

  return {
    label,
    startHour,
    endHour,
    peakTempC: peakTemp,
    minHumidity,
    maxWindKt,
    avgCloudCover: Math.round(avgCloud),
    confidence,
    signalCount: signals,
    day,
  };
}
