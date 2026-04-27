/**
 * useIcaData — poll MeteoGalicia ICA every 30 minutes.
 * Mounted lazy from DeferredHooks (3s after page load).
 *
 * MeteoGalicia ICA updates hourly. 30min cadence catches the hourly tick
 * with margin. Visibility-aware so background tabs idle.
 */

import { useCallback } from 'react';
import { fetchIcaObservations } from '../api/meteoGaliciaIcaClient';
import { useIcaStore } from '../store/icaStore';
import { useVisibilityPolling } from './useVisibilityPolling';

const POLL_INTERVAL = 30 * 60_000; // 30 min

export function useIcaData() {
  const setReadings = useIcaStore((s) => s.setReadings);

  const fetch = useCallback(async () => {
    const data = await fetchIcaObservations();
    if (data.length > 0) setReadings(data);
  }, [setReadings]);

  useVisibilityPolling(fetch, POLL_INTERVAL, true, 18_000); // 18s stagger
}
