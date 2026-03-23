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

  for (const [stationId, history] of readingHistory) {
    const current = currentReadings.get(stationId);
    if (!current?.windSpeed) continue;

    const trend = analyzeWindTrend(history, current);
    if (!trend || trend.signal !== 'rapid') continue;

    // Only alert for significant absolute speeds (>8kt current)
    if (trend.currentKt < 8) continue;

    const stationName = stationId.replace(/^(aemet|mg|mc|wu|nt|skyx)_/, '');

    alerts.push({
      id: `wind-trend-${stationId}`,
      category: 'wind-front',
      severity: trend.currentKt >= 15 ? 'high' : 'moderate',
      score: Math.min(90, Math.round(trend.deltaKt * 8)),
      title: `Cambio brusco: +${trend.deltaKt.toFixed(0)}kt en ${stationName}`,
      detail: `Viento subió de ${trend.startKt.toFixed(0)}kt a ${trend.currentKt.toFixed(0)}kt en 30min. ${trend.dirTrend !== 'stable' ? (trend.dirTrend === 'veering' ? 'Rolada a derechas.' : 'Rolada a izquierdas.') : ''}`,
      icon: 'wind',
      updatedAt: new Date(),
      urgent: trend.currentKt >= 20,
    });
  }

  return alerts;
}
