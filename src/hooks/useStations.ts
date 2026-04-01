import { useEffect, useCallback, useState, useRef } from 'react';
import { useWeatherStore } from '../store/weatherStore';
import { useSectorStore } from '../store/sectorStore';
import { discoverStations } from '../api/stationDiscovery';
import { useToastStore } from '../store/toastStore';

const DISCOVERY_TIMEOUT_MS = 30_000; // 30s max for station discovery

/** Race a promise against a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: estaciones no respondieron en ${ms / 1000}s`)), ms),
    ),
  ]);
}

/** Discover and load stations on mount or sector change, with timeout and retry */
export function useStations() {
  const setStations = useWeatherStore((s) => s.setStations);
  const setLoading = useWeatherStore((s) => s.setLoading);
  const setError = useWeatherStore((s) => s.setError);
  const stations = useWeatherStore((s) => s.stations);
  const activeSector = useSectorStore((s) => s.activeSector);
  const addToast = useToastStore((s) => s.addToast);

  const [retryCount, setRetryCount] = useState(0);
  const lastSectorId = useRef(activeSector.id);

  const load = useCallback(async (signal: { cancelled: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const discovered = await withTimeout(
        discoverStations({
          center: activeSector.center,
          radiusKm: activeSector.radiusKm,
          meteoclimaticRegions: activeSector.meteoclimaticRegions,
          extraCoveragePoints: activeSector.extraCoveragePoints,
          sectorId: activeSector.id,
        }),
        DISCOVERY_TIMEOUT_MS,
      );
      if (!signal.cancelled) {
        setStations(discovered);
        addToast(`${discovered.length} estaciones en ${activeSector.name}`, 'success');
      }
    } catch (err) {
      if (!signal.cancelled) {
        const message = err instanceof Error ? err.message : 'Error descubriendo estaciones';
        setError(message);
        console.error('[useStations]', err);
      }
    } finally {
      if (!signal.cancelled) {
        setLoading(false);
      }
    }
  }, [setStations, setLoading, setError, activeSector]);

  useEffect(() => {
    // Reload when sector changes
    const sectorChanged = lastSectorId.current !== activeSector.id;
    if (sectorChanged) {
      lastSectorId.current = activeSector.id;
      // Clear old stations so discovery runs fresh
      setStations([]);
      // Clear all selections to prevent cross-sector ghost popups
      import('../store/spotStore').then(m => m.useSpotStore.getState().selectSpot(''));
      import('../store/weatherSelectionStore').then(m => m.useWeatherSelectionStore.getState().selectStation(null));
      import('../store/buoyStore').then(m => m.useBuoyStore.getState().selectBuoy(null));
    }
  }, [activeSector.id, setStations]);

  useEffect(() => {
    if (stations.length > 0) return; // Already loaded

    const signal = { cancelled: false };
    load(signal);
    return () => { signal.cancelled = true; };
  }, [stations.length, load, retryCount]);

  const retry = useCallback(() => {
    setRetryCount((c) => c + 1);
  }, []);

  return { stations, retry };
}
