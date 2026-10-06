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
 * True once the lightning, the forecast and the warnings have each had their first answer (a
 * failed forecast counts: it will not come). Before that the prediction is not computed: on 6-oct
 * tabs just opened showed, and logged, 30 % in the Embalse next to 88-98 % from the others, with
 * the same strikes and the forecast rain, the cloud and the MeteoGalicia warning still empty.
 */
export function usePredictionInputsReady(): boolean {
  const lightning = useLightningStore((s) => s.lastFetch !== null);
  const forecast = useForecastStore((s) => s.fetchedAt !== null || s.error !== null);
  const warnings = useWarningsStore((s) => s.lastFetch !== null);
  return lightning && forecast && warnings;
}

/**
 * Returns the current storm prediction, recalculated from live data.
 * Safe to call from any component — reads from Zustand stores.
 */
export function useStormPrediction(): StormPrediction {
  // Use convectionData (Open-Meteo background) for CAPE/CIN/LI — falls back to hourly if same source
  const forecast = useForecastStore((s) => s.convectionData.length > 0 ? s.convectionData : s.hourly);
  const stormAlert = useLightningStore((s) => s.stormAlert);
  const recentActivity = useLightningStore((s) => s.recentActivity);
  const stormShadow = useStormShadowStore((s) => s.stormShadow);
  const sectorWarnings = useWarningsStore((s) => s.sectorWarnings);
  const ready = usePredictionInputsReady();

  return useMemo(() => {
    if (!ready) return NO_PREDICTION;
    // Need at least some data source active. Note recentActivity can keep the
    // prediction alive through a lull even when stormAlert just dropped to
    // 'none' — that's the whole point of the hysteresis.
    if (
      forecast.length === 0 &&
      stormAlert.level === 'none' &&
      recentActivity.count30m === 0 &&
      stormShadow == null &&
      sectorWarnings.length === 0
    ) {
      return NO_PREDICTION;
    }
    return predictStorm(forecast, stormAlert, stormShadow, sectorWarnings, recentActivity);
  }, [ready, forecast, stormAlert, recentActivity, stormShadow, sectorWarnings]);
}
