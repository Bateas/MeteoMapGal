/**
 * Downburst alert builder — surfaces dry-downburst risk to the unified pipeline.
 *
 * Reads current station readings (gust ratios) + the nearest forecast hour
 * (mid-tropo + convection state) and forwards an alert when 3 of 4 signals
 * align. Pure computation — uses data the rest of the pipeline already
 * subscribed to.
 *
 * See `downburstRiskService.ts` for the physics and thresholds.
 */

import type { NormalizedReading } from '../../types/station';
import type { HourlyForecast } from '../../types/forecast';
import type { UnifiedAlert } from './types';
import { evaluateDownburstRisk } from '../downburstRiskService';

// ── Helpers ─────────────────────────────────────────────────

/** Pick the forecast bucket closest to "now". Forecast may include past hours. */
function nearestForecastHour(forecast: HourlyForecast[]): HourlyForecast | null {
  if (!forecast || forecast.length === 0) return null;
  const now = Date.now();
  let best: HourlyForecast | null = null;
  let bestDelta = Infinity;
  for (const h of forecast) {
    const delta = Math.abs(h.time.getTime() - now);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = h;
    }
  }
  return best;
}

// ── Public builder ──────────────────────────────────────────

export function buildDownburstAlerts(
  currentReadings: Map<string, NormalizedReading> | undefined,
  forecast: HourlyForecast[] | undefined,
): UnifiedAlert[] {
  if (!currentReadings || currentReadings.size === 0) return [];
  if (!forecast || forecast.length === 0) return [];

  // Build station gust list (only stations reporting BOTH avg + gust)
  const stations: { stationId: string; windSpeed: number; windGust: number }[] = [];
  for (const [id, r] of currentReadings) {
    if (r.windSpeed === null || r.windGust === null) continue;
    if (r.windSpeed <= 0 || r.windGust <= 0) continue;
    stations.push({ stationId: id, windSpeed: r.windSpeed, windGust: r.windGust });
  }
  if (stations.length === 0) return [];

  const hour = nearestForecastHour(forecast);
  if (!hour) return [];

  const risk = evaluateDownburstRisk({
    stations,
    atmosphere: {
      temperature500hPa: hour.temperature500hPa ?? null,
      cape: hour.cape ?? null,
      liftedIndex: hour.liftedIndex ?? null,
      cloudCover: hour.cloudCover ?? null,
      precipMmH: hour.precipitation ?? null,
    },
  });

  if (!risk.severity) return [];

  // Map severity → score (matches storm alert ranges, 60-90)
  const score = risk.severity === 'high' ? 85 : 65;

  return [{
    id: 'downburst-risk',
    category: 'downburst',
    severity: risk.severity,
    score,
    icon: 'wind',
    title: risk.severity === 'high'
      ? 'Riesgo ALTO de downburst seco'
      : 'Riesgo moderado de downburst',
    detail: risk.summary,
    urgent: risk.severity === 'high',
    updatedAt: new Date(),
    confidence: risk.confidence,
  }];
}
