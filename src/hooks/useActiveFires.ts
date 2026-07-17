/**
 * useActiveFires — poll NASA FIRMS hotspots every 30 minutes.
 * Mounted lazy from DeferredHooks (3s after page load).
 *
 * Why 30min cadence: VIIRS satellite passes Galicia ~4-6 times/day. The
 * ingestor proxy already caches 30min so a tighter interval would just hit
 * the same cached payload. Visibility-aware so background tabs idle.
 */

import { useCallback } from 'react';
import { fetchActiveFires, fetchFireAttribution } from '../api/firmsClient';
import { useFireStore } from '../store/fireStore';
import { useVisibilityPolling } from './useVisibilityPolling';

const POLL_INTERVAL = 30 * 60_000; // 30 min

export function useActiveFires() {
  const setFires = useFireStore((s) => s.setFires);
  const setAttribution = useFireStore((s) => s.setAttribution);

  const fetch = useCallback(async () => {
    // Fires come from the live FIRMS proxy; the lightning attribution comes
    // from our own history. Kept independent so a database hiccup costs the
    // story behind the fire, never the fire itself.
    const [result, attribution] = await Promise.all([
      fetchActiveFires(1), // last 24h
      // 3 days: a strike can smoulder 7-18h before the satellite sees the
      // fire, and yesterday's hotspots are still on the map.
      fetchFireAttribution(3),
    ]);
    setFires(result.fires);
    setAttribution(attribution);
  }, [setFires, setAttribution]);

  useVisibilityPolling(fetch, POLL_INTERVAL, true, 12_000); // 12s stagger to spread startup load
}
