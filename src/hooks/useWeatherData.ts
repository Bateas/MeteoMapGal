import { useCallback, useEffect, useRef } from 'react';
import { useWeatherStore } from '../store/weatherStore';
import { useSectorStore } from '../store/sectorStore';
import { useStations } from './useStations';
import { useAutoRefresh } from './useAutoRefresh';
import { fetchAllObservations, isAemetRateLimited, aemetCooldownRemaining } from '../api/aemetClient';
import { fetchLatestForStations } from '../api/meteogaliciaClient';
import { fetchMeteoclimaticFeed } from '../api/meteoclimaticClient';
import { fetchWUObservations } from '../api/wundergroundClient';
import { fetchNetatmoObservations } from '../api/netatmoClient';
import { fetchOpenMeteoForStations } from '../api/openMeteoClient';
import { normalizeAemetObservation, normalizeMeteoGaliciaObservation, normalizeMeteoclimaticObservation } from '../services/normalizer';
import type { NormalizedReading } from '../types/station';
import { REFRESH_INTERVAL_MS } from '../config/constants';
import { logReadings } from '../services/stationDataLogger';
import { useToastStore } from '../store/toastStore';

export function useWeatherData() {
  const { stations, retry: retryDiscovery } = useStations();
  const activeSector = useSectorStore((s) => s.activeSector);
  const updateReadings = useWeatherStore((s) => s.updateReadings);
  const appendHistory = useWeatherStore((s) => s.appendHistory);
  const loadFromCache = useWeatherStore((s) => s.loadFromCache);
  const setLoading = useWeatherStore((s) => s.setLoading);
  const setError = useWeatherStore((s) => s.setError);
  const updateSourceStatus = useWeatherStore((s) => s.updateSourceStatus);
  const addToast = useToastStore((s) => s.addToast);
  const toastedSourceErrors = useRef(new Set<string>());
  const cacheLoadedRef = useRef(false);

  // Load cached readings on first mount (instant display while fresh data loads)
  useEffect(() => {
    if (!cacheLoadedRef.current) {
      cacheLoadedRef.current = true;
      loadFromCache(activeSector.id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = useCallback(async () => {
    if (stations.length === 0) return;

    setLoading(true);
    setError(null);

    // Build fetch tasks for each source — run all in parallel
    const tasks: Promise<NormalizedReading[]>[] = [];

    // AEMET — skip silently during rate-limit cooldown
    const aemetStationIds = new Set(
      stations.filter((s) => s.source === 'aemet').map((s) => s.id)
    );
    if (aemetStationIds.size > 0) {
      if (isAemetRateLimited()) {
        console.debug(`[WeatherData] AEMET rate-limited, skipping (${aemetCooldownRemaining()}s remaining)`);
      } else {
        tasks.push(
          fetchAllObservations().then((aemetObs) => {
            const readings: NormalizedReading[] = [];
            for (const obs of aemetObs) {
              if (aemetStationIds.has(`aemet_${obs.idema}`)) {
                readings.push(normalizeAemetObservation(obs));
              }
            }
            updateSourceStatus('aemet', true, readings.length);
            return readings;
          }).catch((err) => {
            console.error('[WeatherData] AEMET fetch error:', err);
            updateSourceStatus('aemet', false, 0, String(err));
            return [];
          })
        );
      }
    }

    // MeteoGalicia
    const mgStations = stations.filter((s) => s.source === 'meteogalicia');
    if (mgStations.length > 0) {
      tasks.push(
        fetchLatestForStations(mgStations.map((s) => parseInt(s.id.replace('mg_', ''), 10))).then((mgResults) => {
          const readings: NormalizedReading[] = [];
          for (const [stationId, values] of mgResults) {
            const reading = normalizeMeteoGaliciaObservation(stationId, values);
            if (reading) readings.push(reading);
          }
          updateSourceStatus('meteogalicia', true, readings.length);
          return readings;
        }).catch((err) => {
          console.error('[WeatherData] MeteoGalicia fetch error:', err);
          updateSourceStatus('meteogalicia', false, 0, String(err));
          return [];
        })
      );
    }

    // Meteoclimatic
    const mcStationIds = new Set(
      stations.filter((s) => s.source === 'meteoclimatic').map((s) => s.id)
    );
    if (mcStationIds.size > 0) {
      tasks.push(
        fetchMeteoclimaticFeed(activeSector.meteoclimaticRegions).then((mcFeed) => {
          const readings: NormalizedReading[] = [];
          for (const raw of mcFeed) {
            if (mcStationIds.has(`mc_${raw.id}`)) {
              readings.push(normalizeMeteoclimaticObservation(raw));
            }
          }
          updateSourceStatus('meteoclimatic', true, readings.length);
          return readings;
        }).catch((err) => {
          console.error('[WeatherData] Meteoclimatic fetch error:', err);
          updateSourceStatus('meteoclimatic', false, 0, String(err));
          return [];
        })
      );
    }

    // Weather Underground
    const wuStationIds = stations.filter((s) => s.source === 'wunderground').map((s) => s.id);
    if (wuStationIds.length > 0) {
      tasks.push(
        fetchWUObservations(wuStationIds).then((readings) => {
          updateSourceStatus('wunderground', true, readings.length);
          return readings;
        }).catch((err) => {
          console.error('[WeatherData] WU fetch error:', err);
          updateSourceStatus('wunderground', false, 0, String(err));
          return [];
        })
      );
    }

    // Netatmo — pass active sector center/radius so the bbox covers the right area
    const netatmoStationIds = new Set(
      stations.filter((s) => s.source === 'netatmo').map((s) => s.id)
    );
    if (netatmoStationIds.size > 0) {
      tasks.push(
        fetchNetatmoObservations({ center: activeSector.center, radiusKm: activeSector.radiusKm }).then(({ readings }) => {
          const filtered = readings.filter((r) => netatmoStationIds.has(r.stationId));
          updateSourceStatus('netatmo', true, filtered.length);
          return filtered;
        }).catch((err) => {
          console.error('[WeatherData] Netatmo fetch error:', err);
          updateSourceStatus('netatmo', false, 0, String(err));
          return [];
        })
      );
    }

    try {
      const results = await Promise.all(tasks);
      const allReadings = results.flat();

      if (allReadings.length > 0) {
        updateReadings(allReadings);
        logReadings(allReadings);
      }

      // Toast for source errors (once per source)
      // Derive "ok" from timestamps — SourceStatus has no `.ok` property
      const sourceNames: Record<string, string> = { aemet: 'AEMET', meteogalicia: 'MeteoGalicia', meteoclimatic: 'Meteoclimatic', wunderground: 'Weather Underground', netatmo: 'Netatmo' };
      for (const [src, name] of Object.entries(sourceNames)) {
        const status = useWeatherStore.getState().sourceFreshness.get(src);
        const isOk = status?.lastSuccess && (!status.lastError || status.lastSuccess > status.lastError);
        if (status && !isOk && status.lastError && !toastedSourceErrors.current.has(src)) {
          toastedSourceErrors.current.add(src);
          addToast(`${name}: error de conexión`, 'warning');
        } else if (isOk) {
          toastedSourceErrors.current.delete(src);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error obteniendo datos';
      setError(message);
      addToast('Error general obteniendo datos', 'error');
    } finally {
      setLoading(false);
    }
  }, [stations, activeSector, updateReadings, setLoading, setError, updateSourceStatus]);

  const { lastRefresh, isPolling, forceRefresh } = useAutoRefresh(fetchData, REFRESH_INTERVAL_MS);

  // Load 24h historical data from Open-Meteo on first load (model data, fills charts only)
  // Uses appendHistory — never overwrites currentReadings (real-time station data)
  const hasLoadedHistoryRef = useRef(false);
  const loadHistory = useCallback(async () => {
    if (stations.length === 0) return;
    try {
      const stationCoords = stations.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon }));
      const historyReadings = await fetchOpenMeteoForStations(stationCoords);
      if (historyReadings.length > 0) {
        appendHistory(historyReadings);
      }
    } catch (err) {
      console.error('[WeatherData] Open-Meteo history load error:', err);
    }
  }, [stations, appendHistory]);

  // Reset fetch flags when sector changes (stations go to [] then back)
  const hasFetchedRef = useRef(false);
  useEffect(() => {
    if (stations.length === 0) {
      hasFetchedRef.current = false;
      hasLoadedHistoryRef.current = false;
    }
  }, [stations.length]);

  // Trigger fetch when stations first become available
  // (useAutoRefresh fires before stations are loaded, so we need this)
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

  // ── Auto-refresh 90s after initial discovery — catches late arrivals ──
  const initialRefreshDone = useRef(false);
  useEffect(() => {
    if (stations.length === 0) {
      initialRefreshDone.current = false; // Reset on sector switch
      return;
    }
    if (initialRefreshDone.current) return;
    const timer = setTimeout(() => {
      initialRefreshDone.current = true;
      console.log('[WeatherData] Auto-refresh 90s — catching late arrivals');
      forceRefresh();
    }, 90_000);
    return () => clearTimeout(timer);
  }, [stations.length > 0, forceRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  return { stations, lastRefresh, isPolling, forceRefresh, retryDiscovery };
}
