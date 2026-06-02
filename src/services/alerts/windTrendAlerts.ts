/**
 * Wind trend alerts — detects sudden wind changes from reading history.
 *
 * Triggers when wind speed changes rapidly (>6kt in 30min).
 * Pure computation on existing data — no new API calls.
 */

import type { NormalizedReading } from '../../types/station';
import type { UnifiedAlert } from './types';
import { analyzeWindTrend } from '../windTrendService';
/** Build alerts for sudden wind changes across all stations */
export function buildWindTrendAlerts(
  currentReadings: Map<string, NormalizedReading>,
  readingHistory: Map<string, NormalizedReading[]>,
): UnifiedAlert[] {
  const alerts: UnifiedAlert[] = [];

  // First pass: collect all stations showing a rapid ramp (≥8kt now).
  const rapid: { stationId: string; trend: NonNullable<ReturnType<typeof analyzeWindTrend>> }[] = [];
  for (const [stationId, history] of readingHistory) {
    const current = currentReadings.get(stationId);
    if (!current?.windSpeed) continue;
    const trend = analyzeWindTrend(history, current);
    if (!trend || trend.signal !== 'rapid' || trend.currentKt < 8) continue;
    rapid.push({ stationId, trend });
  }

  // A lone rapid ramp can be a dirty/glitching anemometer (gust spike) — cap it
  // to 'moderate' (informational). 'high'/'urgent' require ≥2 stations ramping
  // this cycle (spatial corroboration → a real front, not one bad sensor).
  const corroborated = rapid.length >= 2;

  for (const { stationId, trend } of rapid) {
    const stationName = stationId.replace(/^(aemet|mg|mc|wu|nt|skyx)_/, '');
    alerts.push({
      id: `wind-trend-${stationId}`,
      category: 'wind-front',
      severity: corroborated && trend.currentKt >= 15 ? 'high' : 'moderate',
      score: Math.min(corroborated ? 90 : 55, Math.round(trend.deltaKt * 8)),
      title: `Cambio brusco: +${trend.deltaKt.toFixed(0)}kt en ${stationName}`,
      detail: `Viento subió de ${trend.startKt.toFixed(0)}kt a ${trend.currentKt.toFixed(0)}kt en 30min.${corroborated ? '' : ' (1 estación — sin confirmar)'} ${trend.dirTrend !== 'stable' ? (trend.dirTrend === 'veering' ? 'Rolada a derechas.' : 'Rolada a izquierdas.') : ''}`,
      icon: 'wind',
      updatedAt: new Date(),
      urgent: corroborated && trend.currentKt >= 20,
    });
  }

  return alerts;
}
