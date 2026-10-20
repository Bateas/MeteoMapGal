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
import { useUIStore } from '../store/uiStore';
import { isCoastalSector } from '../config/sectors';
import { useStormShadowStore } from './useStormShadow';
import { useTemperatureOverlayStore } from '../store/temperatureOverlayStore';
import { useWeatherStore } from '../store/weatherStore';
import { useRainNowStore } from '../store/rainNowStore';
import { useWebcamStore } from '../store/webcamStore';
import { useForecastStore } from './useForecastTimeline';
import { aggregateAllAlerts } from '../services/alertService';
import { checkAllFieldAlerts } from '../services/fieldAlertEngine';
import {
  extractStationTemps,
  analyzeThermalProfile,
} from '../services/lapseRateService';
import { detectFogBySolarSignature, signatureOptions, signatureSites } from '../services/maritimeFogService';
import {
  selectRelevantVisibility,
  visibilitySignature,
  SECTOR_VISIBILITY_RADIUS_FACTOR,
} from '../services/visibilityFreshness';
import { processAlertNotifications } from '../services/notificationService';
import { RIAS_WEBCAMS, ALL_WEBCAMS, webcamSite, isSeaFogCamera, isFogUnreliable } from '../config/webcams';
import { summarizeFogBySite, camerasForSector, sunInView, isUsableVision, type CameraFogRead } from '../services/webcamFogSites';

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
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const sectorCenter = useSectorStore((s) => s.activeSector.center);
  const sectorRadiusKm = useSectorStore((s) => s.activeSector.radiusKm);
  const alphaMode = useUIStore((s) => s.alphaMode);
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
  const forecastFetchedAt = useForecastStore((s) => s.fetchedAt);
  // What the «Lluvia ahora» layer measures: «Lloviendo ahora» and the fog-risk veto (rainNowAlerts.ts).
  const rainSummary = useRainNowStore((s) => s.summary);
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
          sectorCenter,
          airspaceCheck ?? undefined,
          seasonGDD,
        ));
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- historyEpoch is a stable proxy for readingHistory changes
  }, [forecastHourly, historyEpoch, stations, currentReadings, sectorCenter, airspaceCheck, seasonGDD]);

  // ── Effect 3: Unified aggregation + notifications ─────
  // Audit S136+3 #6: signature-hash skip — the 500ms debounce only batches
  // updates WITHIN a single render tick, but useEffect still fires whenever
  // any dep changes. Compare a cheap signature (counts + key timestamps)
  // against last run; if identical, skip the 11 alert builders entirely.
  const lastAggregateSigRef = useRef<string>('');

  useEffect(() => {
    const t = setTimeout(() => {
      // AEMET visibility readings (sector-agnostic map of the 8 Galician stations
      // with a `vis` sensor), gated on BOTH axes before anything reads them:
      //  - distance: a real coastal-fog reading 100km+ away (Fisterra
      //    lighthouse) must NOT fire "Niebla confirmada" over an inland sector.
      //    1.5x radius keeps Ourense (~27km, valid for Embalse), drops Fisterra.
      //  - age: the Map survives an AEMET outage untouched, so without a
      //    freshness gate the alert would keep claiming official confirmation
      //    from a reading that stopped describing the sky hours ago.
      const [secLon, secLat] = sectorCenter;
      const relevantVisibility = selectRelevantVisibility(
        useWeatherStore.getState().visibilityReadings,
        secLat,
        secLon,
        sectorRadiusKm * SECTOR_VISIBILITY_RADIUS_FACTOR,
      );

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
        // alphaMode gates the drone alert filter below — a toggle must
        // invalidate the cache or the list stays stale until data moves
        alphaMode ? 1 : 0,
        // Digest of the GATED visibility set, so the fog alert can be both
        // raised (new AEMET batch) and cleared (last batch ageing out) on its
        // own — neither moves any of the axes above.
        visibilitySignature(relevantVisibility),
        // Raining gauges (and how many have echo over them): the rain alert and the fog veto follow them.
        rainSummary ? `${rainSummary.gauges.length}:${rainSummary.gauges.filter((g) => (g.radarDbz ?? 0) >= 20).length}:${rainSummary.gauges[0]?.mm ?? 0}` : 'norain',
      ].join('|');
      if (sig === lastAggregateSigRef.current) return;
      lastAggregateSigRef.current = sig;

      // Station geo for maritime fog (nearby station lookup; altitude for the near-sea-level signature)
      const stationsGeo = stations.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, altitude: s.altitude, name: s.name }));

      // ── Webcam fog detection (cameras with fogVisible in last 30min) ──
      const visionResults = useWebcamStore.getState().visionResults;
      let webcamFogDetected: boolean | undefined;
      let webcamFogCount = 0;
      let webcamCriticalVisibilityCount = 0;
      let webcamClearCount = 0;
      const webcamFogIds: string[] = [];
      const fogSources: { lat: number; lon: number; type: 'webcam' | 'station' | 'buoy'; id: string }[] = [];
      const fogClearCameras: { lat: number; lon: number }[] = [];
      if (visionResults.size > 0) {
        const now = Date.now();
        webcamFogDetected = false;
        // Only the cameras that can speak for THIS sector (webcamFogSites.ts): its own or shared ones,
        // within the same 1.5x radius as the official visibility.
        const webcamCoords = camerasForSector(ALL_WEBCAMS, sectorId, secLat, secLon, sectorRadiusKm * SECTOR_VISIBILITY_RADIUS_FACTOR);

        // Pre-check: any AEMET station reporting vis<1km right now? If so,
        // it's a regional fog event — webcams in low-confidence partly-cloudy
        // state should be counted as evidence even if the IA didn't trip
        // fogVisible (moondream often misclassifies blanket marine fog as
        // 'good visibility partly_cloudy' — confirmed S136+3 Cíes case).
        // Uses the gated subset: only fresh readings from near this sector.
        // Not when the report puts the low visibility down to rain (as the alert itself does).
        let regionalAemetFog = false;
        for (const v of relevantVisibility.values()) {
          if (v.visibility < 1 && !v.precipitating) { regionalAemetFog = true; break; }
        }
        const reads: CameraFogRead[] = [];
        for (const [id, result] of visionResults) {
          const ageOk = (now - result.analyzedAt.getTime()) < 30 * 60_000;
          if (!ageOk || !isUsableVision(result.weather.sky)) continue;
          const cam = webcamCoords.get(id);
          if (!cam) continue;
          // A camera high up (Castrove, 515 m) can be inside the low cloud with the water clear below.
          if (!isSeaFogCamera(id)) continue;
          // With the low sun in front, the washed-out image reads as fog: that camera cannot judge.
          if (sunInView(cam, result.analyzedAt.getTime())) continue;
          const directFog = result.weather.fogVisible;
          // The model's sky 'rain' is rain it saw, not fog (precipitation is not carried by the API).
          const lowConfNonClear = result.confidence === 'low'
            && result.weather.sky !== 'clear'
            && result.weather.sky !== 'rain'
            && !result.weather.precipitation;
          const indirectFog = regionalAemetFog && lowConfNonClear;
          // visibility 'poor' (<1km from the IA) is a critical signal — same
          // weight as AEMET station vis<1km. Lets single-camera marine fog
          // in zones without nearby AEMET vis (Cíes / outer rías) fire alerts.
          const fog = directFog || indirectFog;
          // A camera whose fog is unreliable (misted glass) still counts when it sees clear.
          if (fog && isFogUnreliable(id)) continue;
          if (!fog) fogClearCameras.push({ lat: cam.lat, lon: cam.lon });
          reads.push({ id, fog, critical: result.weather.visibility === 'poor' });
        }
        // Cameras on the same mast count once, and when they disagree the fog one does not
        // count (webcamFogSites.ts): every count below is of sites, not cameras.
        const bySite = summarizeFogBySite(reads, webcamSite);
        webcamFogDetected = bySite.fogSites > 0;
        webcamFogCount = bySite.fogSites;
        webcamCriticalVisibilityCount = bySite.criticalSites;
        webcamClearCount = bySite.clearSites;
        for (const id of bySite.fogCameraIds) {
          webcamFogIds.push(id);
          const c = webcamCoords.get(id);
          if (c) fogSources.push({ lat: c.lat, lon: c.lon, type: 'webcam', id });
        }
      }

      // Stations with the fog signature (saturated air, sun blocked against its clear-sky value, near
      // sea level, no rain): evidence only, drawn where an alert that it supports fires.
      // Only drawn when they make the evidence (two sites or more): one site is not a signature.
      const sigNow = Date.now();
      const solarFogStations = detectFogBySolarSignature(currentReadings, stationsGeo, sigNow, relevantVisibility,
        signatureOptions(currentReadings, sigNow, readingHistory, fogClearCameras));
      if (signatureSites(solarFogStations) >= 2) {
        for (const s of solarFogStations) fogSources.push({ lat: s.lat, lon: s.lon, type: 'station', id: s.id });
      }

      // AEMET stations with measured visibility <1km → official fog. Works 24/7
      // (not daylight-dependent). Uses the gated subset built above, so neither
      // far coastal fog (Fisterra ~110km) nor a reading frozen by an AEMET
      // outage can paint fog over this sector.
      for (const v of relevantVisibility.values()) {
        if (v.visibility >= 1 || v.precipitating) continue; // low visibility in rain is not fog
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
          sectorId: sectorId,
          willCallBuildMaritimeFog: isCoastalSector(sectorId) && buoys.length > 0,
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
        // Maritime alerts (cross-sea, fog) only apply to coastal sectors
        buoys: isCoastalSector(sectorId) && buoys.length > 0 ? buoys : undefined,
        stationsGeo: stationsGeo.length > 0 ? stationsGeo : undefined,
        rainNow: rainSummary && !rainSummary.sim ? { gauges: rainSummary.gauges } : undefined,
        teleconnections: teleconnectionsRef.current.length > 0 ? teleconnectionsRef.current : undefined,
        webcamFogDetected,
        webcamFogCount,
        webcamFogIds,
        webcamCriticalVisibilityCount,
        webcamClearCount,
        fogSources: fogSources.length > 0 ? fogSources : undefined,
        regionalVisibility: relevantVisibility.size > 0 ? relevantVisibility : undefined,
        fogClearCameras,
      });
      // Drone surfaces are Alpha-gated (FieldDrawer tab hidden without
      // alphaMode) — the drone meteo alert must follow, or "Dron: Precaución"
      // keeps showing in alert lists with no drone tab to act on.
      const visibleAlerts = alphaMode ? alerts : alerts.filter((a) => a.category !== 'drone');
      setUnifiedAlerts(visibleAlerts, risk);
      // Trigger notifications for new/escalated alerts
      processAlertNotifications(visibleAlerts, risk, notifConfig);
    }, 500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- historyEpoch is a stable proxy for readingHistory
  }, [
    stormAlert, stormShadow, thermalProfile, fieldAlerts, forecastFetchedAt,
    setUnifiedAlerts, notifConfig, currentReadings, historyEpoch,
    buoys, stations, sectorId, teleconnectionsRef, alphaMode, rainSummary,
  ]);

  return fieldAlerts;
}
