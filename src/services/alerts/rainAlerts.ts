/**
 * Rain alert builder — detects incoming precipitation from forecast data.
 *
 * Pure computation service: reads from forecastStore (Open-Meteo hourly data),
 * no new API calls, no new intervals.
 *
 * Scans next 6 hours of forecast. Generates alerts when precipProbability >= 60%
 * AND precipitation >= 0.5mm. Severity escalates with intensity.
 */

import type { HourlyForecast } from '../../types/forecast';
import type { UnifiedAlert } from './types';

// ── Thresholds ──────────────────────────────────────────────

const LOOKAHEAD_HOURS = 6;
const MIN_PROB = 60;          // % — minimum probability to trigger
const MIN_PRECIP_MM = 0.5;    // mm/h — minimum precipitation to trigger
/** AEMET intensity scale, mm/h: moderada from 2, fuerte from 15 (the yellow warning), muy fuerte from 30. */
const RAIN_MODERATE_MM = 2;
const RAIN_HEAVY_MM = 15;
const RAIN_VERY_HEAVY_MM = 30;

// ── Helpers ─────────────────────────────────────────────────

function hoursFromNow(time: Date, now: Date): number {
  return (time.getTime() - now.getTime()) / (1000 * 60 * 60);
}

function etaLabel(hours: number): string {
  if (hours < 0.5) return 'inminente';
  if (hours < 1) return 'en <1h';
  return `en ~${Math.round(hours)}h`;
}

interface RainEvent {
  /** Hours from now to the first rain hour */
  etaHours: number;
  /** Max precipitation (mm/h) across the window */
  maxPrecipMm: number;
  /** Max probability (%) across the window */
  maxProb: number;
  /** Number of rainy hours in the window */
  rainyHours: number;
  /** Total accumulated precipitation (mm) */
  totalMm: number;
  /** Time label of the first rainy hour */
  firstHourLabel: string;
}

// ── Core detection ──────────────────────────────────────────

/**
 * Scan forecast for upcoming rain events within LOOKAHEAD_HOURS.
 * Returns null if no significant rain is detected.
 */
function detectRainEvent(forecast: HourlyForecast[]): RainEvent | null {
  const now = new Date();
  let maxPrecipMm = 0;
  let maxProb = 0;
  let rainyHours = 0;
  let totalMm = 0;
  let firstEtaHours = Infinity;
  let firstHourLabel = '';

  for (const hour of forecast) {
    const eta = hoursFromNow(hour.time, now);
    // Skip past hours and hours beyond lookahead
    if (eta < -0.5) continue;
    if (eta > LOOKAHEAD_HOURS) break;

    const precip = hour.precipitation ?? 0;
    const prob = hour.precipProbability ?? 0;

    if (prob >= MIN_PROB && precip >= MIN_PRECIP_MM) {
      rainyHours++;
      totalMm += precip;
      if (precip > maxPrecipMm) maxPrecipMm = precip;
      if (prob > maxProb) maxProb = prob;
      if (eta < firstEtaHours) {
        firstEtaHours = eta;
        firstHourLabel = hour.time.toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
        });
      }
    }
  }

  if (rainyHours === 0) return null;

  return {
    etaHours: Math.max(0, firstEtaHours),
    maxPrecipMm,
    maxProb,
    rainyHours,
    totalMm,
    firstHourLabel,
  };
}

// ── Alert builder ───────────────────────────────────────────

export function buildRainAlerts(forecast?: HourlyForecast[]): UnifiedAlert[] {
  if (!forecast || forecast.length === 0) return [];

  const event = detectRainEvent(forecast);
  if (!event) return [];

  // ── Determine severity ──
  // AEMET's intensity scale (moderada 2-15, fuerte 15-30, muy fuerte >30 mm/h). The yellow
  // warning for rain starts at 15 mm/h; this used to say PELIGRO above 5 mm/h, and on 29-sep a
  // red banner announced a 14.8 mm three-hour rain on the card of a ría spot during a gale, when
  // the danger was the wind. A forecast of rain is not a danger to someone on the water, and the
  // probability says how sure the model is, not how hard it rains: it no longer raises the level.
  const p = event.maxPrecipMm;
  const band = p >= RAIN_VERY_HEAVY_MM ? { severity: 'critical' as const, base: 85 + Math.min(5, (p - RAIN_VERY_HEAVY_MM) / 6), max: 90 }
    : p >= RAIN_HEAVY_MM ? { severity: 'high' as const, base: 55 + Math.min(25, (p - RAIN_HEAVY_MM) * 1.6), max: 84 }
    : p >= RAIN_MODERATE_MM ? { severity: 'moderate' as const, base: 40 + Math.min(14, (p - RAIN_MODERATE_MM) * 1.1), max: 54 }
    : { severity: 'info' as const, base: 30 + Math.min(10, (p - MIN_PRECIP_MM) * 6.6), max: 44 };
  const severity = band.severity;

  // ── Score: inside the band of its severity (riskEngine thresholds 25/55/85) ──
  let score = band.base;
  const isImminent = event.etaHours < 1;
  if (isImminent) score += 10;
  if (event.maxProb >= 90) score += 5;
  score = Math.round(Math.min(band.max, score));

  // ── Title ──
  const eta = etaLabel(event.etaHours);
  const intensityLabel =
    p >= RAIN_VERY_HEAVY_MM ? 'Lluvia muy fuerte prevista'
      : p >= RAIN_HEAVY_MM ? 'Lluvia fuerte prevista'
        : p >= RAIN_MODERATE_MM ? 'Lluvia moderada prevista'
          : 'Lluvia prevista';
  const title = `${intensityLabel} ${eta}`;

  // ── Detail ──
  const parts: string[] = [];
  parts.push(`${event.maxPrecipMm.toFixed(1)} mm/h max`);
  parts.push(`${event.maxProb}% prob`);
  if (event.rainyHours > 1) {
    parts.push(`${event.rainyHours}h de lluvia`);
    parts.push(`${event.totalMm.toFixed(1)} mm acum.`);
  }
  parts.push(`desde ${event.firstHourLabel}`);

  return [{
    id: 'rain-forecast',
    category: 'rain',
    severity,
    score,
    icon: 'cloud-rain',
    title,
    detail: parts.join(' · '),
    urgent: isImminent && (severity === 'high' || severity === 'critical'),
    updatedAt: new Date(),
    confidence: Math.min(100, event.maxProb),
  }];
}
