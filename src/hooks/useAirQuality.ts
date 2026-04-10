/**
 * Air Quality polling hook — fetches UV, PM2.5, AQI, pollen every 30min.
 * Zone-based: uses active sector center coordinates.
 * Deferred: runs inside DeferredHooks (3s after mount).
 */

import { useCallback } from 'react';
import { useVisibilityPolling } from './useVisibilityPolling';
import { useSectorStore } from '../store/sectorStore';
import { useAirQualityStore } from '../store/airQualityStore';
import { fetchAirQuality } from '../api/airQualityClient';
import { SECTORS } from '../config/sectors';

const POLL_INTERVAL = 30 * 60 * 1000; // 30 minutes

export function useAirQuality(): void {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const setCurrent = useAirQualityStore((s) => s.setCurrent);
  const setHourly = useAirQualityStore((s) => s.setHourly);

  const poll = useCallback(async () => {
    const sector = SECTORS.find((s) => s.id === sectorId);
    if (!sector) return;

    const [lon, lat] = sector.center;
    try {
      const { current, hourly } = await fetchAirQuality(lat, lon);
      setCurrent(sectorId, current);
      setHourly(sectorId, hourly);
    } catch (err) {
      console.warn('[AirQuality] Fetch failed:', err);
    }
  }, [sectorId, setCurrent, setHourly]);

  useVisibilityPolling(poll, POLL_INTERVAL);
}
