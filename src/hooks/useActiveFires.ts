/**
 * useActiveFires — poll NASA FIRMS hotspots every 30 minutes.
 * Mounted lazy from DeferredHooks (3s after page load).
 *
 * Why 30min cadence: VIIRS satellite passes Galicia ~4-6 times/day. The
 * ingestor proxy already caches 30min so a tighter interval would just hit
 * the same cached payload. Visibility-aware so background tabs idle.
 *
 * The store keeps raw hotspot detections. Grouping them into FIRES happens in
 * `selectFireClusters`, which memoises on the stored array so every surface
 * (ticker, map markers, smoke) works off one identical cluster list. Clustering
 * per-surface instead would let them drift apart silently.
 */

import { useCallback } from 'react';
import { fetchActiveFires, fetchFireAttribution } from '../api/firmsClient';
import { fetchFireEvents } from '../api/fireEventsClient';
import { useFireStore } from '../store/fireStore';
import { useVisibilityPolling } from './useVisibilityPolling';

const POLL_INTERVAL = 30 * 60_000; // 30 min

export function useActiveFires() {
  const setFires = useFireStore((s) => s.setFires);
  const setAttribution = useFireStore((s) => s.setAttribution);
  const setEvents = useFireStore((s) => s.setEvents);

  const fetch = useCallback(async () => {
    // Fires come from the live FIRMS proxy; the lightning attribution comes
    // from our own history. Kept independent so a database hiccup costs the
    // story behind the fire, never the fire itself.
    const [result, attribution, events] = await Promise.all([
      fetchActiveFires(1), // last 24h
      // 3 days: a strike can smoulder 7-18h before the satellite sees the
      // fire, and yesterday's hotspots are still on the map.
      fetchFireAttribution(3),
      // 7 days: EFFIS keeps revising an event's burnt area for days after it
      // starts, and a fire that ran this week still explains today's haze.
      fetchFireEvents(7),
    ]);
    setFires(result.fires);
    setAttribution(attribution);
    setEvents(events);
  }, [setFires, setAttribution, setEvents]);

  useVisibilityPolling(fetch, POLL_INTERVAL, true, 12_000); // 12s stagger to spread startup load
}
