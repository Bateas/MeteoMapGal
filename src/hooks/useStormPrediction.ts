/**
 * useStormPrediction — Combines forecast + lightning + storm shadow + MG warnings
 * to produce a real-time StormPrediction for UI consumption.
 *
 * Pure derivation from existing stores — no new fetches.
 * Recalculates whenever any input store changes.
 */

import { useMemo } from 'react';
import { useLightningStore } from './useLightningData';
import { useStormShadowStore } from './useStormShadow';
import { useForecastStore } from './useForecastTimeline';
import { useWarningsStore } from './useWarnings';
import { predictStorm, type StormPrediction } from '../services/stormPredictor';

const NO_PREDICTION: StormPrediction = {
  probability: 0,
  horizon: 'none',
  severity: 'none',
  summary: 'Sin indicios de tormenta.',
  signals: [],
  etaMinutes: null,
  action: 'Sin riesgo detectado.',
};

/**
 * Returns the current storm prediction, recalculated from live data.
 * Safe to call from any component — reads from Zustand stores.
 */
export function useStormPrediction(): StormPrediction {
  const forecast = useForecastStore((s) => s.hourly);
  const stormAlert = useLightningStore((s) => s.stormAlert);
  const stormShadow = useStormShadowStore((s) => s.stormShadow);
  const sectorWarnings = useWarningsStore((s) => s.sectorWarnings);

  return useMemo(() => {
    // Need at least some data source active
    if (
      forecast.length === 0 &&
      stormAlert.level === 'none' &&
      stormShadow == null &&
      sectorWarnings.length === 0
    ) {
      return NO_PREDICTION;
    }
    return predictStorm(forecast, stormAlert, stormShadow, sectorWarnings);
  }, [forecast, stormAlert, stormShadow, sectorWarnings]);
}
