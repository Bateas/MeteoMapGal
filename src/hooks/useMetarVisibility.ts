/**
 * useMetarVisibility — certified airport visibility (METAR) feeding the
 * regional visibility pipeline.
 *
 * Adds LEVX (Vigo/Peinador — the gate of the Ria de Vigo, uncovered by the
 * 8 AEMET vis stations), LEST and LECO. Entries land in
 * `weatherStore.visibilityReadings` under the `metar_` prefix, so the fog
 * halo, the age/distance freshness gates and the multi-evidence fog rules
 * consume them with zero new UI — the integration is invisible by design.
 *
 * METARs publish every ~30min; polling at 10min bounds worst-case staleness
 * without hammering the proxy (which itself caches 5min). The first poll is
 * delayed a few seconds to stay out of the startup fetch burst.
 */

import { useRef } from 'react';
import { useVisibilityPolling } from './useVisibilityPolling';
import { fetchMetarVisibility } from '../api/metarClient';
import { useWeatherStore } from '../store/weatherStore';

const METAR_POLL_MS = 10 * 60 * 1000;
const METAR_INITIAL_DELAY_MS = 5_000;

export function useMetarVisibility(): void {
  // Poll + visibilitychange can both fire the callback in quick succession;
  // one in-flight fetch at a time is plenty for a 30min-cadence source.
  const inFlightRef = useRef(false);

  useVisibilityPolling(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const readings = await fetchMetarVisibility();
      // Empty = endpoint missing (dev proxy points at prod pre-deploy),
      // network error, or nothing parseable. Keep the previous entries:
      // the store contract is "hold last known values while the source is
      // down" and every consumer already gates on timestamp.
      if (readings.length > 0) {
        // getState() inside a poll callback — a reactive selector here would
        // re-create subscriptions and cascade re-fetches.
        useWeatherStore.getState().mergeVisibilityReadings(readings, 'metar_');
      }
    } finally {
      inFlightRef.current = false;
    }
  }, METAR_POLL_MS, true, METAR_INITIAL_DELAY_MS);
}
