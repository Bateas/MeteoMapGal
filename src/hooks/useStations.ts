import { useEffect, useCallback, useState } from 'react';
import { useWeatherStore } from '../store/weatherStore';
import { discoverStations } from '../api/stationDiscovery';

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

/** Discover and load stations on mount, with timeout and retry */
export function useStations() {
  const setStations = useWeatherStore((s) => s.setStations);
  const setLoading = useWeatherStore((s) => s.setLoading);
  const setError = useWeatherStore((s) => s.setError);
  const stations = useWeatherStore((s) => s.stations);

  const [retryCount, setRetryCount] = useState(0);

  const load = useCallback(async (signal: { cancelled: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const discovered = await withTimeout(discoverStations(), DISCOVERY_TIMEOUT_MS);
      if (!signal.cancelled) {
        setStations(discovered);
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
  }, [setStations, setLoading, setError]);

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
