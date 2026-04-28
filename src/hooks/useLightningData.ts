import { useRef, useCallback } from 'react';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { fetchLightningStrikes, distanceKm } from '../api/lightningClient';
import { trackStorms } from '../services/stormTracker';
import type { StormCluster } from '../services/stormTracker';
import type { LightningStrike, StormAlert, StormAlertLevel } from '../types/lightning';
import type { ClusterSnapshot } from '../services/stormTracker';
import { useSectorStore } from '../store/sectorStore';
import { useWeatherStore } from '../store/weatherStore';
import { useForecastStore } from './useForecastTimeline';
import { enrichClustersWithIntensity, type NearbyPrecipReading, type ConvectionState } from '../services/stormIntensityService';
import { useVisibilityPolling } from './useVisibilityPolling';

/**
 * Alert distance thresholds (updated per user request):
 * - danger:  < 5 km  → storm overhead
 * - warning: < 25 km → storm approaching
 * - watch:   < 50 km → activity in the area
 */
const DANGER_KM = 5;
const WARNING_KM = 25;
const WATCH_KM = 80; // Extended from 50 — shows "Rayos detectados" info for distant strikes

/** Only consider strikes from the last 30 minutes for alert scoring */
const RECENT_WINDOW_MS = 30 * 60 * 1000;

/** Polling interval: 2 minutes */
const POLL_INTERVAL_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------------------
// Zustand store for lightning state
// ---------------------------------------------------------------------------

interface LightningState {
  strikes: LightningStrike[];
  stormAlert: StormAlert;
  clusters: StormCluster[];
  lastFetch: Date | null;
  isLoading: boolean;
  error: string | null;
  showOverlay: boolean;
  clusterHistory: ClusterSnapshot[];

  setStrikes: (strikes: LightningStrike[]) => void;
  setAlert: (alert: StormAlert) => void;
  setClusters: (clusters: StormCluster[]) => void;
  setClusterHistory: (history: ClusterSnapshot[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setLastFetch: (date: Date) => void;
  toggleOverlay: () => void;
}

const NO_ALERT: StormAlert = {
  level: 'none',
  nearestKm: Infinity,
  recentCount: 0,
  trend: 'none',
  etaMinutes: null,
  speedKmh: null,
  bearingDeg: null,
  clusters: [],
  updatedAt: new Date(),
};

export const useLightningStore = create<LightningState>()(
  devtools(
    (set, get) => ({
      strikes: [],
      stormAlert: NO_ALERT,
      clusters: [],
      lastFetch: null,
      isLoading: false,
      error: null,
      showOverlay: true,
      clusterHistory: [],

      setStrikes: (strikes) => set({ strikes }),
      setAlert: (alert) => set({ stormAlert: alert }),
      setClusters: (clusters) => set({ clusters }),
      setClusterHistory: (clusterHistory) => set({ clusterHistory }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setLastFetch: (date) => set({ lastFetch: date }),
      toggleOverlay: () => set({ showOverlay: !get().showOverlay }),
    }),
    { name: 'lightning-store' },
  ),
);

// ---------------------------------------------------------------------------
// Alert computation (enhanced with cluster data)
// ---------------------------------------------------------------------------

function computeStormAlert(
  strikes: LightningStrike[],
  clusters: StormCluster[],
  previousAlert: StormAlert,
  centerLat: number,
  centerLon: number,
): StormAlert {
  const now = Date.now();

  // Only recent strikes for alert evaluation
  const recent = strikes.filter(
    (s) => now - s.timestamp < RECENT_WINDOW_MS,
  );

  if (recent.length === 0) {
    return { ...NO_ALERT, updatedAt: new Date() };
  }

  // Distance of each recent strike to active sector center
  const distances = recent.map((s) =>
    distanceKm(s.lat, s.lon, centerLat, centerLon),
  );
  const nearestKm = Math.round(Math.min(...distances) * 10) / 10;

  // Determine alert level (updated thresholds: 5 / 25 / 50)
  let level: StormAlertLevel = 'none';
  if (nearestKm <= DANGER_KM) level = 'danger';
  else if (nearestKm <= WARNING_KM) level = 'warning';
  else if (nearestKm <= WATCH_KM) level = 'watch';

  // Count strikes within alert radius (50km)
  const recentCount = distances.filter((d) => d <= WATCH_KM).length;

  // Trend: compare current nearest distance with previous
  let trend: StormAlert['trend'] = 'stationary';
  if (previousAlert.nearestKm < Infinity && nearestKm < Infinity) {
    const delta = nearestKm - previousAlert.nearestKm;
    if (delta < -2) trend = 'approaching';
    else if (delta > 2) trend = 'receding';
  } else if (nearestKm < Infinity && previousAlert.nearestKm === Infinity) {
    trend = 'approaching';
  }

  // Get ETA and velocity from the nearest approaching cluster
  let etaMinutes: number | null = null;
  let speedKmh: number | null = null;
  let bearingDeg: number | null = null;

  const nearestApproaching = clusters.find((c) => c.approaching && c.etaMinutes !== null);
  if (nearestApproaching) {
    etaMinutes = nearestApproaching.etaMinutes;
    speedKmh = nearestApproaching.velocity?.speedKmh ?? null;
    bearingDeg = nearestApproaching.velocity?.bearingDeg ?? null;
    trend = 'approaching'; // override with cluster-based trend
  }

  return {
    level,
    nearestKm,
    recentCount,
    trend,
    etaMinutes,
    speedKmh,
    bearingDeg,
    clusters,
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Hook: polls lightning data and computes storm alerts
// ---------------------------------------------------------------------------

// Export the ClusterSnapshot type for stormTracker
export type { ClusterSnapshot };

// ── S126 storm intensity enrichment helpers ──────────────────────────
// Pull-on-demand state collectors. Don't create reactive subscriptions —
// the storm tracker poll cycle is the only consumer.

function collectNearbyReadings(): NearbyPrecipReading[] {
  const wx = useWeatherStore.getState();
  const stations = wx.stations;
  const now = Date.now();
  const out: NearbyPrecipReading[] = [];
  for (const s of stations) {
    const r = wx.currentReadings.get(s.id);
    if (!r || r.precipitation == null) continue;
    out.push({
      lat: s.lat,
      lon: s.lon,
      precipMm: r.precipitation,
      ageSeconds: r.timestamp ? Math.floor((now - r.timestamp.getTime()) / 1000) : Infinity,
    });
  }
  return out;
}

function collectCurrentConvection(): ConvectionState | null {
  const fc = useForecastStore.getState();
  const list = fc.convectionData.length > 0 ? fc.convectionData : fc.hourly;
  if (list.length === 0) return null;
  // Find the entry closest to NOW
  const now = Date.now();
  let best = list[0];
  let bestDist = Math.abs(best.time.getTime() - now);
  for (const f of list) {
    const d = Math.abs(f.time.getTime() - now);
    if (d < bestDist) { best = f; bestDist = d; }
  }
  // T_500hPa plumbed S126+1: fetched alongside CAPE/LI from Open-Meteo.
  // When present (Auto path), unlocks 'probable' hail risk via cold-tops rule.
  // WRF-MG primary path won't carry it (MeteoSIX doesn't expose pressure-level
  // temps) but convectionData is always Open-Meteo background, so it's there.
  return {
    cape: best.cape ?? null,
    liftedIndex: best.liftedIndex ?? null,
    temperature500hPa: best.temperature500hPa ?? null,
  };
}

export function useLightningData() {
  const {
    setStrikes,
    setAlert,
    setClusters,
    setClusterHistory,
    setLoading,
    setError,
    setLastFetch,
    stormAlert,
  } = useLightningStore(useShallow((s) => ({
    setStrikes: s.setStrikes,
    setAlert: s.setAlert,
    setClusters: s.setClusters,
    setClusterHistory: s.setClusterHistory,
    setLoading: s.setLoading,
    setError: s.setError,
    setLastFetch: s.setLastFetch,
    stormAlert: s.stormAlert,
  })));

  const activeSector = useSectorStore((s) => s.activeSector);
  const sectorCenter = activeSector.center; // [lon, lat]

  const prevAlertRef = useRef(stormAlert);
  const historyRef = useRef<ClusterSnapshot[]>([]);

  const retryCountRef = useRef(0);

  const fetchAndUpdate = useCallback(async () => {
    const centerLat = sectorCenter[1];
    const centerLon = sectorCenter[0];

    setLoading(true);
    try {
      const strikes = await fetchLightningStrikes();
      setStrikes(strikes);
      setError(null);
      retryCountRef.current = 0; // reset on success

      // Track storm clusters with velocity vectors
      const { clusters, history } = trackStorms(
        strikes,
        historyRef.current,
        centerLat,
        centerLon,
      );
      historyRef.current = history;
      setClusterHistory(history);

      // S126 — enrich each cluster with intensity classification.
      // Pulls precip readings + convection state via getState() so we don't
      // add extra reactive dependencies to this cycle.
      const enriched = enrichClustersWithIntensity(
        clusters,
        collectNearbyReadings(),
        collectCurrentConvection(),
      );
      setClusters(enriched);

      const alert = computeStormAlert(strikes, clusters, prevAlertRef.current, centerLat, centerLon);
      setAlert(alert);
      prevAlertRef.current = alert;

      setLastFetch(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error obteniendo rayos';
      setError(msg);
      console.error('[Lightning] Poll error:', err);

      // Exponential backoff retry (5s, 15s, 45s) — max 3 retries per poll cycle
      if (retryCountRef.current < 3) {
        const delay = 5000 * Math.pow(3, retryCountRef.current);
        retryCountRef.current++;
        console.log(`[Lightning] Retry ${retryCountRef.current}/3 in ${delay / 1000}s`);
        setTimeout(() => {
          fetchAndUpdate();
        }, delay);
      }
    } finally {
      setLoading(false);
    }
  }, [setStrikes, setAlert, setClusters, setClusterHistory, setLoading, setError, setLastFetch, sectorCenter]);

  // Visibility-aware polling — pauses when tab is hidden
  useVisibilityPolling(fetchAndUpdate, POLL_INTERVAL_MS);
}
