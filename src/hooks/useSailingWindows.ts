/**
 * Best Sailing Windows hook — computes per-spot windows from forecast data.
 *
 * Reuses forecast from useForecastStore (fetches for both sectors via useForecastTimeline).
 * No duplicate Open-Meteo fetch — single source of truth.
 * Polls every 30 min with visibility-aware polling.
 * Stores results in spotStore.sailingWindows + sectorForecast.
 */

import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSectorStore } from '../store/sectorStore';
import { useSpotStore } from '../store/spotStore';
import { useForecastStore } from './useForecastTimeline';
import { useThermalStore } from '../store/thermalStore';
import { useVisibilityPolling } from './useVisibilityPolling';
import { getSpotsForSector } from '../config/spots';
import { computeSpotWindows } from '../services/sailingWindowService';
import type { HourlyForecast } from '../types/forecast';
import type { SpotWindowResult } from '../services/sailingWindowService';

/** Poll every 30 min */
const POLL_INTERVAL_MS = 30 * 60_000;

// ── Hook ─────────────────────────────────────────────────────

export function useSailingWindows() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const setSailingWindows = useSpotStore((s) => s.setSailingWindows);
  const setSectorForecast = useSpotStore((s) => s.setSectorForecast);

  const embalseHourly = useForecastStore((s) => s.hourly);
  const thermalRules = useThermalStore((s) => s.rules);

  const poll = useCallback(() => {
    // Reuse forecast from useForecastTimeline (single source, both sectors)
    if (embalseHourly.length === 0) return; // Not yet loaded

    const forecast = embalseHourly;
    const spots = getSpotsForSector(sectorId);
    const windows = new Map<string, SpotWindowResult>();

    for (const spot of spots) {
      const rules = spot.thermalDetection ? thermalRules : undefined;
      const result = computeSpotWindows(forecast, spot, rules);
      windows.set(spot.id, result);
    }

    setSailingWindows(windows);
    setSectorForecast(forecast);

    const totalWindows = Array.from(windows.values()).reduce((s, w) => s + w.windows.length, 0);
    console.debug(`[SailingWindows] ${totalWindows} windows for ${spots.length} spots`);
  }, [sectorId, embalseHourly, thermalRules, setSailingWindows, setSectorForecast]);

  // Defer first load to let critical data (stations, forecast) load first
  const deferredPoll = useCallback(async () => {
    const windowsFetched = useSpotStore.getState().windowsFetchedAt;
    if (windowsFetched === 0) {
      // First run — wait 10s to avoid competing with startup burst
      await new Promise(r => setTimeout(r, 10_000));
    }
    return poll();
  }, [poll]);

  useVisibilityPolling(deferredPoll, POLL_INTERVAL_MS);
}
