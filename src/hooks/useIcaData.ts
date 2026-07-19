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
    if (data.length > 0) {
      setReadings(data);
      return;
    }

    // Empty means the fetch failed or the source published nothing. Keep the
    // last good readings while they are still recent — one transient failure
    // should not blank the map — but drop them once they are too old to
    // describe conditions now. This is the wall-clock backstop to the store's
    // own expiry timer, which a suspended machine can delay past its deadline.
    const ica = useIcaStore.getState();
    if (!ica.isFresh()) ica.clear();
  }, [setReadings]);

  useVisibilityPolling(fetch, POLL_INTERVAL, true, 18_000); // 18s stagger
}
