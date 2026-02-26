import { useCallback, useEffect, useRef } from 'react';
import { useWeatherStore } from '../store/weatherStore';
import { useStations } from './useStations';
import { useAutoRefresh } from './useAutoRefresh';
import { fetchAllObservations } from '../api/aemetClient';
import { fetchLatestForStations } from '../api/meteogaliciaClient';
import { fetchMeteoclimaticFeed } from '../api/meteoclimaticClient';
import { fetchWUObservations } from '../api/wundergroundClient';
import { fetchNetatmoObservations } from '../api/netatmoClient';
import { fetchOpenMeteoForStations } from '../api/openMeteoClient';
import { normalizeAemetObservation, normalizeMeteoGaliciaObservation, normalizeMeteoclimaticObservation } from '../services/normalizer';
import type { NormalizedReading } from '../types/station';
import { REFRESH_INTERVAL_MS } from '../config/constants';
import { logReadings } from '../services/stationDataLogger';

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

      // Fetch Meteoclimatic observations (single XML feed for all stations)
      const mcStationIds = new Set(
        stations.filter((s) => s.source === 'meteoclimatic').map((s) => s.id)
      );
      if (mcStationIds.size > 0) {
        try {
          const mcFeed = await fetchMeteoclimaticFeed();
          for (const raw of mcFeed) {
            const normalizedId = `mc_${raw.id}`;
            if (mcStationIds.has(normalizedId)) {
              allReadings.push(normalizeMeteoclimaticObservation(raw));
            }
          }
        } catch (err) {
          console.error('[WeatherData] Meteoclimatic fetch error:', err);
        }
      }

      // Fetch Weather Underground PWS observations
      const wuStationIds = stations
        .filter((s) => s.source === 'wunderground')
        .map((s) => s.id);
      if (wuStationIds.length > 0) {
        try {
          const wuReadings = await fetchWUObservations(wuStationIds);
          allReadings.push(...wuReadings);
        } catch (err) {
          console.error('[WeatherData] WU fetch error:', err);
        }
      }

      // Fetch Netatmo observations (returns both stations and readings)
      const netatmoStationIds = stations
        .filter((s) => s.source === 'netatmo')
        .map((s) => s.id);
      if (netatmoStationIds.length > 0) {
        try {
          const { readings } = await fetchNetatmoObservations();
          // Only keep readings for stations we know about
          const known = new Set(netatmoStationIds);
          for (const reading of readings) {
            if (known.has(reading.stationId)) {
              allReadings.push(reading);
            }
          }
        } catch (err) {
          console.error('[WeatherData] Netatmo fetch error:', err);
        }
      }

      if (allReadings.length > 0) {
        updateReadings(allReadings);
        // Log real station data for local historical analysis
        logReadings(allReadings);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error obteniendo datos';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [stations, updateReadings, setLoading, setError]);

  const { lastRefresh, isPolling, forceRefresh } = useAutoRefresh(fetchData, REFRESH_INTERVAL_MS);

  // Load 24h historical data from Open-Meteo on first load (model data, fills charts)
  const hasLoadedHistoryRef = useRef(false);
  const loadHistory = useCallback(async () => {
    if (stations.length === 0) return;
    try {
      const stationCoords = stations.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon }));
      const historyReadings = await fetchOpenMeteoForStations(stationCoords);
      if (historyReadings.length > 0) {
        updateReadings(historyReadings);
      }
    } catch (err) {
      console.error('[WeatherData] Open-Meteo history load error:', err);
    }
  }, [stations, updateReadings]);

  // Trigger fetch when stations first become available
  // (useAutoRefresh fires before stations are loaded, so we need this)
  const hasFetchedRef = useRef(false);
  useEffect(() => {
    if (stations.length > 0 && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      forceRefresh();
      // Load 24h history in background
      if (!hasLoadedHistoryRef.current) {
        hasLoadedHistoryRef.current = true;
        loadHistory();
      }
    }
  }, [stations.length, forceRefresh, loadHistory]);

  return { stations, lastRefresh, isPolling, forceRefresh };
}
