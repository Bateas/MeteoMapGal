/**
 * useUnifiedAlertPipeline — centralized alert aggregation pipeline.
 *
 * Extracted from AppShell.tsx (TIER 2 A2-5 refactor, S136+3+2) — the
 * 3-effect chain (lapseRate → fieldAlerts → unified aggregation) lived
 * in the AppShell render scope with 12+ store subscriptions, causing
 * re-renders of the entire shell whenever any input changed.
 *
 * Now isolated in this hook: AppShell only subscribes to whatever the
 * hook RETURNS (currently `fieldAlerts` for the Header badge). The 11
 * alert builders + thermal profile computation + webcam/AEMET fog
 * integration all stay here. Re-renders are scoped to this hook's
 * consumers.
 *
 * Effects (in order — each depends on the previous via stores):
 *   1. Thermal lapse rate (debounce 500ms) → useTemperatureOverlayStore
 *   2. Field alerts (debounce 500ms) → local state, returned to AppShell
 *   3. Unified aggregation (debounce 500ms + signature-hash skip) →
 *      useAlertStore + notification dispatch
 */
import { useEffect, useRef, useState, useMemo } from 'react';
import type { MutableRefObject } from 'react';
import type { NormalizedStation } from '../types/station';
import type { AirspaceCheck } from '../services/airspaceService';
import type { TeleconnectionIndex } from '../api/naoClient';
import { useAlertStore } from '../store/alertStore';
import { useBuoyStore } from '../store/buoyStore';
import { useLightningStore } from './useLightningData';
import { useNotificationStore } from '../store/notificationStore';
import { useSectorStore } from '../store/sectorStore';
import { useStormShadowStore } from './useStormShadow';
import { useTemperatureOverlayStore } from '../store/temperatureOverlayStore';
import { useWeatherStore } from '../store/weatherStore';
import { useWebcamStore } from '../store/webcamStore';
import { useForecastStore } from './useForecastTimeline';
import { aggregateAllAlerts } from '../services/alertService';
import { checkAllFieldAlerts } from '../services/fieldAlertEngine';
import {
  extractStationTemps,
  analyzeThermalProfile,
} from '../services/lapseRateService';
import { detectFogBySolarSignature } from '../services/maritimeFogService';
import { haversineDistance } from '../services/geoUtils';
import { processAlertNotifications } from '../services/notificationService';
import { RIAS_WEBCAMS } from '../config/webcams';

interface PipelineParams {
  stations: NormalizedStation[];
  airspaceCheck: AirspaceCheck | null;
  seasonGDD: { accumulated: number; days: number } | null;
  teleconnectionsRef: MutableRefObject<TeleconnectionIndex[]>;
}

export function useUnifiedAlertPipeline({
  stations,
  airspaceCheck,
  seasonGDD,
  teleconnectionsRef,
}: PipelineParams): ReturnType<typeof checkAllFieldAlerts> | null {
  // ── Inputs from stores ───────────────────────────────
  const activeSector = useSectorStore((s) => s.activeSector);
  const convectionData = useForecastStore((s) => s.convectionData);
  const hourly = useForecastStore((s) => s.hourly);
  // Audit S136+3 #16: separate selectors + useMemo prevents ternary from
  // returning a new reference each render (causing the consumer effects to
  // re-fire on every parent re-render).
  const forecastHourly = useMemo(
    () => (convectionData.length > 0 ? convectionData : hourly),
    [convectionData, hourly],
  );
  const readingHistory = useWeatherStore((s) => s.readingHistory);
  const historyEpoch = useWeatherStore((s) => s.historyEpoch);
  const currentReadings = useWeatherStore((s) => s.currentReadings);
  const stormAlert = useLightningStore((s) => s.stormAlert);
  const stormShadow = useStormShadowStore((s) => s.stormShadow);
  const thermalProfile = useTemperatureOverlayStore((s) => s.thermalProfile);
  const setUnifiedAlerts = useAlertStore((s) => s.setAlerts);
  const notifConfig = useNotificationStore((s) => s.config);
  const buoys = useBuoyStore((s) => s.buoys);
  const sstHistory = useBuoyStore((s) => s.sstHistory);
  const forecastFetchedAt = useForecastStore((s) => s.fetchedAt);
  const setThermalProfile = useTemperatureOverlayStore((s) => s.setThermalProfile);

  // Ref kept fresh — passed by reference to aggregator so we don't trigger
  // a re-aggregation just because the array identity changed.
  const forecastRef = useRef(forecastHourly);
  forecastRef.current = forecastHourly;

  // ── Effect 1: Thermal lapse rate (writes to store) ───────
  // Audit S136+3 #10: debounce 500ms — currentReadings mutates on every
  // weather poll (~5min) but the lapse rate doesn't change meaningfully
  // within seconds. The debounce batches multi-station updates that arrive
  // in quick succession during a single poll cycle.
  useEffect(() => {
    if (stations.length === 0 || currentReadings.size === 0) return;
    const t = setTimeout(() => {
      const temps = extractStationTemps(stations, currentReadings);
      if (temps.length < 2) return;
      const profile = analyzeThermalProfile(temps);
      setThermalProfile(profile);
    }, 500);
    return () => clearTimeout(t);
  }, [stations, currentReadings, setThermalProfile]);

  // ── Effect 2: Field alerts (returned for Header consumption) ──
  const [fieldAlerts, setFieldAlerts] = useState<ReturnType<typeof checkAllFieldAlerts> | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      if (forecastHourly.length > 0 || readingHistory.size > 0) {
        setFieldAlerts(checkAllFieldAlerts(
          forecastHourly,
          readingHistory,
          stations,
          currentReadings,
          activeSector.center,
          airspaceCheck ?? undefined,
          seasonGDD,
        ));
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- historyEpoch is a stable proxy for readingHistory changes
  }, [forecastHourly, historyEpoch, stations, currentReadings, activeSector.center, airspaceCheck, seasonGDD]);

  // ── Effect 3: Unified aggregation + notifications ─────
  // Audit S136+3 #6: signature-hash skip — the 500ms debounce only batches
  // updates WITHIN a single render tick, but useEffect still fires whenever
  // any dep changes. Compare a cheap signature (counts + key timestamps)
  // against last run; if identical, skip the 11 alert builders entirely.
  const lastAggregateSigRef = useRef<string>('');

  useEffect(() => {
    const t = setTimeout(() => {
      // Cheap input-signature check — skip if nothing relevant changed
      // (Map.size + history epoch + storm timestamp + forecast fetchedAt
      // are the high-signal axes for "is this rebuild meaningful?").
      // S136+3+2: fixed pre-existing TS errors (detectedAt / lapseRate didn't
      // exist on the types — were silently typed `any` in some configs).
      // Replaced with real fields that signal "this shadow/profile is different".
      const sig = [
        currentReadings.size,
        historyEpoch,
        stormAlert?.level ?? 'none',
        stormShadow?.confidence ?? 0,
        stormShadow?.shadowedStations?.length ?? 0,
        forecastFetchedAt ?? 0,
        buoys.length,
        thermalProfile?.overallLapseRate ?? 0,
      ].join('|');
      if (sig === lastAggregateSigRef.current) return;
      lastAggregateSigRef.current = sig;

      // Station geo for maritime fog (nearby station lookup)
      const stationsGeo = stations.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon }));

      // ── Webcam fog detection (cameras with fogVisible in last 30min) ──
      const visionResults = useWebcamStore.getState().visionResults;
      let webcamFogDetected: boolean | undefined;
      let webcamFogCount = 0;
      let webcamCriticalVisibilityCount = 0;
      const webcamFogIds: string[] = [];
      const fogSources: { lat: number; lon: number; type: 'webcam' | 'station' | 'buoy'; id: string }[] = [];
      if (visionResults.size > 0) {
        const now = Date.now();
        webcamFogDetected = false;
        const webcamCoords = new Map<string, { lat: number; lon: number }>();
        for (const w of RIAS_WEBCAMS) webcamCoords.set(w.id, { lat: w.lat, lon: w.lon });

        // Pre-check: any AEMET station reporting vis<1km right now? If so,
        // it's a regional fog event — webcams in low-confidence partly-cloudy
        // state should be counted as evidence even if the IA didn't trip
        // fogVisible (moondream often misclassifies blanket marine fog as
        // 'good visibility partly_cloudy' — confirmed S136+3 Cíes case).
        const aemetVis = useWeatherStore.getState().visibilityReadings;
        let regionalAemetFog = false;
        if (aemetVis) {
          for (const v of aemetVis.values()) {
            if (v.visibility < 1) { regionalAemetFog = true; break; }
          }
        }
        for (const [id, result] of visionResults) {
          const ageOk = (now - result.analyzedAt.getTime()) < 30 * 60_000;
          if (!ageOk || result.beaufort < 0) continue;
          const directFog = result.weather.fogVisible;
          const lowConfNonClear = result.confidence === 'low'
            && result.weather.sky !== 'clear'
            && !result.weather.precipitation;
          const indirectFog = regionalAemetFog && lowConfNonClear;
          if (directFog || indirectFog) {
            webcamFogDetected = true;
            webcamFogCount++;
            webcamFogIds.push(id);
            // visibility 'poor' (<1km from the IA) is a critical signal — same
            // weight as AEMET station vis<1km. Lets single-camera marine fog
            // in zones without nearby AEMET vis (Cíes / outer rías) fire alerts.
            if (result.weather.visibility === 'poor') webcamCriticalVisibilityCount++;
            const c = webcamCoords.get(id);
            if (c) fogSources.push({ lat: c.lat, lon: c.lon, type: 'webcam', id });
          }
        }
      }

      // Stations with solar+humidity fog signature — daylight + interior-sun gate
      // enforced by detectFogBySolarSignature (prevents night solar=0 spam).
      const solarFogStations = detectFogBySolarSignature(currentReadings, stationsGeo);
      for (const s of solarFogStations) {
        fogSources.push({ lat: s.lat, lon: s.lon, type: 'station', id: s.id });
      }

      // AEMET stations with measured visibility <1km → official fog. Works 24/7
      // (not daylight-dependent like solar signature). Filter by 1.5× sector
      // radius — fog 130km away is irrelevant to the user.
      const visMap = useWeatherStore.getState().visibilityReadings;
      const [secLon, secLat] = activeSector.center;
      const sectorMaxDistKm = activeSector.radiusKm * 1.5;
      for (const v of visMap.values()) {
        if (v.visibility >= 1) continue;
        const distKm = haversineDistance(secLat, secLon, v.lat, v.lon);
        if (distKm > sectorMaxDistKm) continue;
        fogSources.push({ lat: v.lat, lon: v.lon, type: 'station', id: v.stationId });
      }

      // ── DEV SIMULATION: ?simfog=id1,id2 inject fake fog detectors ──
      try {
        const simfog = new URLSearchParams(window.location.search).get('simfog');
        if (simfog) {
          const camCoords = new Map(RIAS_WEBCAMS.map(w => [w.id, { lat: w.lat, lon: w.lon }]));
          const stCoords = new Map(stationsGeo.map(s => [s.id, { lat: s.lat, lon: s.lon }]));
          for (const id of simfog.split(',').map(s => s.trim()).filter(Boolean)) {
            const c = camCoords.get(id) ?? stCoords.get(id);
            if (c) {
              fogSources.push({ lat: c.lat, lon: c.lon, type: 'webcam', id: `sim-${id}` });
              webcamFogCount++;
              webcamFogIds.push(`sim-${id}`);
              webcamFogDetected = true;
            }
          }
          if (fogSources.length > 0) {
            console.log('[SIM FOG] Injected', fogSources.length, 'fake detectors:', fogSources.map(s => s.id).join(', '));
          }
        }
      } catch (err) { console.warn('[SIM FOG] error:', err); }

      // ── DEBUG: trace fog alert input ──
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
        console.log('[useUnifiedAlertPipeline] fog inputs:', {
          buoys: buoys.length,
          stationsGeo: stationsGeo.length,
          currentReadings: currentReadings.size,
          webcamFogCount,
          webcamFogIds,
          fogSources: fogSources.length,
          sectorId: activeSector.id,
          willCallBuildMaritimeFog: activeSector.id === 'rias' && buoys.length > 0,
        });
      }

      const { alerts, risk } = aggregateAllAlerts({
        stormAlert,
        thermalProfile,
        fieldAlerts,
        forecast: forecastRef.current,
        stormShadow,
        currentReadings,
        readingHistory,
        // Maritime alerts (cross-sea, fog, upwelling) only apply to coastal Rías sector
        buoys: activeSector.id === 'rias' && buoys.length > 0 ? buoys : undefined,
        sstHistory: activeSector.id === 'rias' && sstHistory.size > 0 ? sstHistory : undefined,
        stationsGeo: stationsGeo.length > 0 ? stationsGeo : undefined,
        teleconnections: teleconnectionsRef.current.length > 0 ? teleconnectionsRef.current : undefined,
        webcamFogDetected,
        webcamFogCount,
        webcamFogIds,
        webcamCriticalVisibilityCount,
        fogSources: fogSources.length > 0 ? fogSources : undefined,
        regionalVisibility: useWeatherStore.getState().visibilityReadings,
      });
      setUnifiedAlerts(alerts, risk);
      // Trigger notifications for new/escalated alerts
      processAlertNotifications(alerts, risk, notifConfig);
    }, 500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- historyEpoch is a stable proxy for readingHistory
  }, [
    stormAlert, stormShadow, thermalProfile, fieldAlerts, forecastFetchedAt,
    setUnifiedAlerts, notifConfig, currentReadings, historyEpoch,
    buoys, sstHistory, stations, activeSector.id, teleconnectionsRef,
  ]);

  return fieldAlerts;
}
