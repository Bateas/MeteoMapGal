import { useEffect } from 'react';
import { useWeatherStore } from '../store/weatherStore';
import { discoverStations } from '../api/stationDiscovery';

/** Discover and load stations on mount */
export function useStations() {
  const setStations = useWeatherStore((s) => s.setStations);
  const setLoading = useWeatherStore((s) => s.setLoading);
  const setError = useWeatherStore((s) => s.setError);
  const stations = useWeatherStore((s) => s.stations);

  useEffect(() => {
    if (stations.length > 0) return; // Already loaded

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const discovered = await discoverStations();
        if (!cancelled) {
          setStations(discovered);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Error descubriendo estaciones';
          setError(message);
          console.error('[useStations]', err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [stations.length, setStations, setLoading, setError]);

  return stations;
}
