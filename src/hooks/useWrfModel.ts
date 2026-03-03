/**
 * useWrfModel — Resolves and manages the WRF THREDDS model run lifecycle.
 *
 * On activation (when WRF layer is selected), resolves the latest available
 * model run, generates time steps, and stores them in weatherLayerStore.
 * Auto-refreshes every 30 minutes to pick up new model runs.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useWeatherLayerStore } from '../store/weatherLayerStore';
import { resolveAvailableRun } from '../api/wrfWmsClient';

/** Re-check model run availability every 30 min */
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export function useWrfModel() {
  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const wrfModelRun = useWeatherLayerStore((s) => s.wrfModelRun);
  const setWrfModelRun = useWeatherLayerStore((s) => s.setWrfModelRun);
  const setWrfAvailableTimes = useWeatherLayerStore((s) => s.setWrfAvailableTimes);
  const setWrfLoading = useWeatherLayerStore((s) => s.setWrfLoading);
  const setWrfError = useWeatherLayerStore((s) => s.setWrfError);
  const setWrfTimeIndex = useWeatherLayerStore((s) => s.setWrfTimeIndex);

  const isActive = activeLayer === 'wrf';
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resolveRun = useCallback(async () => {
    setWrfLoading(true);
    setWrfError(null);

    try {
      const result = await resolveAvailableRun();

      if (result) {
        setWrfModelRun(result.modelRun);
        setWrfAvailableTimes(result.timeSteps);
        // Reset time index if the run changed or if current index is out of bounds
        const currentIndex = useWeatherLayerStore.getState().wrfTimeIndex;
        if (currentIndex >= result.timeSteps.length) {
          setWrfTimeIndex(0);
        }
        console.debug(`[WRF] Model run resolved: ${result.modelRun} (${result.timeSteps.length} steps)`);
      } else {
        setWrfError('No hay datos WRF disponibles');
        setWrfModelRun(null);
        setWrfAvailableTimes([]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error cargando modelo WRF';
      setWrfError(msg);
      console.error('[WRF] Resolve error:', err);
    } finally {
      setWrfLoading(false);
    }
  }, [setWrfModelRun, setWrfAvailableTimes, setWrfLoading, setWrfError, setWrfTimeIndex]);

  // Resolve model run when WRF layer is activated
  useEffect(() => {
    if (!isActive) return;

    // Only resolve if we don't have a model run yet
    if (!wrfModelRun) {
      resolveRun();
    }

    // Periodic refresh to pick up new model runs
    intervalRef.current = setInterval(resolveRun, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, wrfModelRun, resolveRun]);
}
