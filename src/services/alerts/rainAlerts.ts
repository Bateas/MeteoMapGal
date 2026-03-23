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
  let severity: 'moderate' | 'high' | 'critical';
  if (event.maxPrecipMm > 5) {
    severity = 'critical';
  } else if (event.maxPrecipMm > 2 || event.maxProb > 80) {
    severity = 'high';
  } else {
    severity = 'moderate';
  }

  // ── Score: 30-90 range ──
  // Base from precipitation intensity
  let score: number;
  if (event.maxPrecipMm > 5) {
    score = 75 + Math.min(15, (event.maxPrecipMm - 5) * 3); // 75-90
  } else if (event.maxPrecipMm > 2) {
    score = 50 + Math.min(25, (event.maxPrecipMm - 2) * 8); // 50-74
  } else {
    score = 30 + Math.min(20, (event.maxPrecipMm - 0.5) * 13); // 30-50
  }

  // Urgency boost: rain within 1h
  const isImminent = event.etaHours < 1;
  if (isImminent) score = Math.min(90, score + 10);

  // Probability boost
  if (event.maxProb >= 90) score = Math.min(90, score + 5);

  score = Math.round(score);

  // ── Title ──
  const eta = etaLabel(event.etaHours);
  const intensityLabel =
    event.maxPrecipMm > 5
      ? 'Lluvia intensa prevista'
      : event.maxPrecipMm > 2
        ? 'Lluvia moderada prevista'
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
    urgent: isImminent && severity !== 'moderate',
    updatedAt: new Date(),
    confidence: Math.min(100, event.maxProb),
  }];
}
