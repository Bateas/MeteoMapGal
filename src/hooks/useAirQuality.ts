/**
 * Hook to poll UV + PM2.5 data every 30min.
 * Non-critical — writes to store, read by SpotPopup badges and ticker.
 * Mounted in DeferredHooks (3s after page load).
 */
import { useCallback } from 'react';
import { fetchAirQualityCurrent } from '../api/airQualityClient';
import { useAirQualityStore } from '../store/airQualityStore';
import { useSectorStore } from '../store/sectorStore';
import { useVisibilityPolling } from './useVisibilityPolling';

const POLL_INTERVAL = 30 * 60_000; // 30 min

export function useAirQuality() {
  const center = useSectorStore((s) => s.activeSector.center);
  const setData = useAirQualityStore((s) => s.setData);

  const fetchAQ = useCallback(async () => {
    const [lon, lat] = center;
    const result = await fetchAirQualityCurrent(lat, lon);
    if (result) setData(result);
  }, [center, setData]);

  useVisibilityPolling(fetchAQ, POLL_INTERVAL, true, 10_000); // 10s stagger
}
