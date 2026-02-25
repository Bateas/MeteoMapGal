import { useCallback, useEffect, useRef } from 'react';
import { useWeatherStore } from '../store/weatherStore';
import { useStations } from './useStations';
import { useAutoRefresh } from './useAutoRefresh';
import { fetchAllObservations } from '../api/aemetClient';
import { fetchLatestForStations } from '../api/meteogaliciaClient';
import { normalizeAemetObservation, normalizeMeteoGaliciaObservation } from '../services/normalizer';
import type { NormalizedReading } from '../types/station';
import { REFRESH_INTERVAL_MS } from '../config/constants';

export function useWeatherData() {
  const stations = useStations();
  const updateReadings = useWeatherStore((s) => s.updateReadings);
  const setLoading = useWeatherStore((s) => s.setLoading);
  const setError = useWeatherStore((s) => s.setError);

  const fetchData = useCallback(async () => {
    if (stations.length === 0) return;

    setLoading(true);
    setError(null);
    const allReadings: NormalizedReading[] = [];

    try {
      // Fetch AEMET observations (single request for all stations)
      const aemetStationIds = new Set(
        stations.filter((s) => s.source === 'aemet').map((s) => s.id)
      );

      if (aemetStationIds.size > 0) {
        try {
          const aemetObs = await fetchAllObservations();
          for (const obs of aemetObs) {
            const stationId = `aemet_${obs.idema}`;
            if (aemetStationIds.has(stationId)) {
              allReadings.push(normalizeAemetObservation(obs));
            }
          }
        } catch (err) {
          console.error('[WeatherData] AEMET fetch error:', err);
        }
      }

      // Fetch MeteoGalicia observations (per-station)
      const mgStations = stations.filter((s) => s.source === 'meteogalicia');
      if (mgStations.length > 0) {
        try {
          const mgIds = mgStations.map((s) => parseInt(s.id.replace('mg_', ''), 10));
          const mgResults = await fetchLatestForStations(mgIds);

          for (const [stationId, values] of mgResults) {
            const reading = normalizeMeteoGaliciaObservation(stationId, values);
            if (reading) {
              allReadings.push(reading);
            }
          }
        } catch (err) {
          console.error('[WeatherData] MeteoGalicia fetch error:', err);
        }
      }

      if (allReadings.length > 0) {
        updateReadings(allReadings);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error obteniendo datos';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [stations, updateReadings, setLoading, setError]);

  const { lastRefresh, isPolling, forceRefresh } = useAutoRefresh(fetchData, REFRESH_INTERVAL_MS);

  // Trigger fetch when stations first become available
  // (useAutoRefresh fires before stations are loaded, so we need this)
  const hasFetchedRef = useRef(false);
  useEffect(() => {
    if (stations.length > 0 && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      forceRefresh();
    }
  }, [stations.length, forceRefresh]);

  return { stations, lastRefresh, isPolling, forceRefresh };
}
