/**
 * useActiveFires — poll NASA FIRMS hotspots every 30 minutes.
 * Mounted lazy from DeferredHooks (3s after page load).
 *
 * Why 30min cadence: VIIRS satellite passes Galicia ~4-6 times/day. The
 * ingestor proxy already caches 30min so a tighter interval would just hit
 * the same cached payload. Visibility-aware so background tabs idle.
 */

import { useCallback } from 'react';
import { fetchActiveFires } from '../api/firmsClient';
import { useFireStore } from '../store/fireStore';
import { useVisibilityPolling } from './useVisibilityPolling';

const POLL_INTERVAL = 30 * 60_000; // 30 min

export function useActiveFires() {
  const setFires = useFireStore((s) => s.setFires);

  const fetch = useCallback(async () => {
    const result = await fetchActiveFires(1); // last 24h
    setFires(result.fires);
  }, [setFires]);

  useVisibilityPolling(fetch, POLL_INTERVAL, true, 12_000); // 12s stagger to spread startup load
}
