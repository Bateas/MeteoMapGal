import { useRef, useCallback, useEffect } from 'react';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { fetchLightningStrikes, distanceKm } from '../api/lightningClient';
import { trackStorms } from '../services/stormTracker';
import { detectGustFronts } from '../services/gustFrontService';
import type { StormCluster } from '../services/stormTracker';
import type { LightningStrike, StormAlert, StormAlertLevel } from '../types/lightning';
import type { ClusterSnapshot } from '../services/stormTracker';
import { useSectorStore } from '../store/sectorStore';
import { useWeatherStore } from '../store/weatherStore';
import type { RecentLightningActivity } from '../services/stormPredictor';
import { useVisibilityPolling } from './useVisibilityPolling';
import { assessSpotLightningRisk } from '../services/lightningProximityService';

/**
 * Alert levels, measured from the sector centre:
 * - danger / warning: the lightning safety rule (lightningProximityService, the one behind the
 *   map banner and Telegram): >= 2 ground strikes within 10 km, or 1 with >= 3 within 25 km /
 *   >= 3 within 25 km, or 1 alone within 10 km, in its 20-min window.
 * - watch: any strike within WATCH_KM in the last 30 min (information, not a warning).
 */
const WATCH_KM = 80; // Extended from 50 — shows "Rayos detectados" info for distant strikes

/** Only consider strikes from the last 30 minutes for alert scoring */
const RECENT_WINDOW_MS = 30 * 60 * 1000;

/** Polling interval for quiet conditions (no recent nearby strikes). */
const POLL_INTERVAL_NORMAL_MS = 2 * 60 * 1000;
/** Polling interval when a storm is active (recent strikes nearby).
 *  Shorter cadence + matching shorter cache TTL (see lightningClient.ts)
 *  cuts worst-case render lag during storms from ~4 min to ~1.5 min. */
const POLL_INTERVAL_STORM_MS = 60 * 1000;
/** Thresholds for "storm active" — adaptive polling activates when EITHER
 *  - a strike was published in the last 5 min within the watch radius, OR
 *  - sustained activity (≥5 strikes) within the last 15 min.
 *
 *  Why the OR fallback: MG's publish lag is typically 3-5 min, so strikes
 *  often appear with age 4-5 min on first poll. A strict count5m≥1 gate
 *  silently fails to activate when every strike crosses the 5 min boundary
 *  just before we see it. Confirmed live during a night storm:
 *  Network panel showed 2:44 between polls despite ~10 strikes/min nearby.
 *  Adding count15m≥5 catches the "sustained storm" case even when MG lag
 *  pushes individual strikes past the 5 min cutoff. */
const STORM_ACTIVE_COUNT5M_MIN = 1;
const STORM_ACTIVE_COUNT15M_MIN = 5;

// ---------------------------------------------------------------------------
// Zustand store for lightning state
// ---------------------------------------------------------------------------

interface LightningState {
  strikes: LightningStrike[];
  stormAlert: StormAlert;
  /** Windowed strike counts within WATCH_KM — fuels stormPredictor hysteresis */
  recentActivity: RecentLightningActivity;
  clusters: StormCluster[];
  lastFetch: Date | null;
  isLoading: boolean;
  error: string | null;
  showOverlay: boolean;
  clusterHistory: ClusterSnapshot[];
  /** Stations marking outflow signature ahead of an active cluster */
  gustFronts: import('../services/gustFrontService').GustFrontDetection[];

  setStrikes: (strikes: LightningStrike[]) => void;
  setAlert: (alert: StormAlert) => void;
  setRecentActivity: (a: RecentLightningActivity) => void;
  setClusters: (clusters: StormCluster[]) => void;
  setClusterHistory: (history: ClusterSnapshot[]) => void;
  setGustFronts: (fronts: import('../services/gustFrontService').GustFrontDetection[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setLastFetch: (date: Date | null) => void;
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

const NO_ACTIVITY: RecentLightningActivity = { count30m: 0, count15m: 0, count5m: 0 };

/**
 * Windowed strike counts within WATCH_KM of the sector center. Pure +
 * testable. Powers the stormPredictor temporal hysteresis so a brief lull
 * between strikes doesn't collapse severity to 'none' mid-storm.
 */
export function computeRecentActivity(
  strikes: LightningStrike[],
  centerLat: number,
  centerLon: number,
  now: number = Date.now(),
): RecentLightningActivity {
  let c30 = 0;
  let c15 = 0;
  let c5 = 0;
  for (const s of strikes) {
    const ageMs = now - s.timestamp;
    if (ageMs < 0 || ageMs >= 30 * 60_000) continue;
    if (distanceKm(s.lat, s.lon, centerLat, centerLon) > WATCH_KM) continue;
    c30++;
    if (ageMs < 15 * 60_000) c15++;
    if (ageMs < 5 * 60_000) c5++;
  }
  return { count30m: c30, count15m: c15, count5m: c5 };
}

export const useLightningStore = create<LightningState>()(
  devtools(
    (set, get) => ({
      strikes: [],
      stormAlert: NO_ALERT,
      recentActivity: NO_ACTIVITY,
      clusters: [],
      lastFetch: null,
      isLoading: false,
      error: null,
      showOverlay: true,
      clusterHistory: [],
      gustFronts: [],

      setStrikes: (strikes) => set({ strikes }),
      setAlert: (alert) => set({ stormAlert: alert }),
      setRecentActivity: (recentActivity) => set({ recentActivity }),
      setClusters: (clusters) => set({ clusters }),
      setClusterHistory: (clusterHistory) => set({ clusterHistory }),
      setGustFronts: (gustFronts) => set({ gustFronts }),
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

export function computeStormAlert(
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

  // Level: the same rule as the safety banner and Telegram, so the bar can no longer say «AVISO»
  // while they stay quiet (6-oct: «aviso, 11 km» for 30 min from one strike, the next at 28 km).
  const ground = recent
    .filter((s) => !s.cloudToCloud)
    .map((s) => ({ lat: s.lat, lon: s.lon, time: new Date(s.timestamp) }));
  const risk = assessSpotLightningRisk(
    [{ id: 'sector', name: 'sector', lat: centerLat, lon: centerLon }], ground, new Date(now),
  )[0];
  let level: StormAlertLevel = 'none';
  if (risk?.level === 'peligro') level = 'danger';
  else if (risk?.level === 'aviso') level = 'warning';
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

  // At danger level the storm is here: an arrival time for another cluster
  // («ETA 72 min» with lightning at 1.4 km, 6-oct replay) only contradicts the danger.
  const nearestApproaching = level === 'danger' ? undefined : clusters.find((c) => c.approaching && c.etaMinutes !== null);
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

// Pull-on-demand: no reactive subscription, the storm tracker poll cycle is the only consumer.
function collectGustFrontReadings(): import('../services/gustFrontService').GustFrontReading[] {
  const wx = useWeatherStore.getState();
  const now = Date.now();
  const out: import('../services/gustFrontService').GustFrontReading[] = [];
  for (const s of wx.stations) {
    const r = wx.currentReadings.get(s.id);
    if (!r || r.windSpeed == null || r.windGust == null || r.windDirection == null) continue;
    if (!r.timestamp) continue;
    const ageMin = (now - r.timestamp.getTime()) / 60_000;
    out.push({
      stationId: s.id,
      stationName: s.name,
      lat: s.lat,
      lon: s.lon,
      windMs: r.windSpeed,
      gustMs: r.windGust,
      windDirDeg: r.windDirection,
      ageMin,
    });
  }
  return out;
}

export function useLightningData() {
  const {
    setStrikes,
    setAlert,
    setClusters,
    setClusterHistory,
    setGustFronts,
    setLoading,
    setError,
    setLastFetch,
    setRecentActivity,
    stormAlert,
  } = useLightningStore(useShallow((s) => ({
    setStrikes: s.setStrikes,
    setAlert: s.setAlert,
    setClusters: s.setClusters,
    setClusterHistory: s.setClusterHistory,
    setGustFronts: s.setGustFronts,
    setLoading: s.setLoading,
    setError: s.setError,
    setLastFetch: s.setLastFetch,
    setRecentActivity: s.setRecentActivity,
    stormAlert: s.stormAlert,
  })));

  const sectorCenter = useSectorStore((s) => s.activeSector.center); // [lon, lat]

  const prevAlertRef = useRef(stormAlert);
  const historyRef = useRef<ClusterSnapshot[]>([]);

  const retryCountRef = useRef(0);
  /** The pending retry, so a remount or a new failure never leaves two timers running (15-oct audit). */
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); }, []);

  // Read recentActivity reactively so the storm-active flag drives both the
  // cache TTL passed into fetchLightningStrikes() and the poll cadence below.
  const recentActivity = useLightningStore((s) => s.recentActivity);
  const stormActive =
    recentActivity.count5m >= STORM_ACTIVE_COUNT5M_MIN ||
    recentActivity.count15m >= STORM_ACTIVE_COUNT15M_MIN;

  const fetchAndUpdate = useCallback(async () => {
    const centerLat = sectorCenter[1];
    const centerLon = sectorCenter[0];

    setLoading(true);
    try {
      const { strikes, asOf, fresh, feedStale } = await fetchLightningStrikes({ stormActive });
      // Our API did not answer: keep the last picture as it was — a storm that stops being read
      // is not a storm that went away — and let the indicator show how old it is (lastFetch stays
      // at the last good answer). Before 9-oct the meteo2api fallback hid this case.
      if (!fresh && feedStale) {
        // Our API answers, but MeteoGalicia has not answered the ingestor since `lastOkAt` (3.0.4):
        // the strikes stop there. Same as above, and the indicator counts from that answer.
        setLastFetch(feedStale.lastOkAt != null ? new Date(feedStale.lastOkAt) : null);
        throw new Error(feedStale.lastOkAt != null
          ? `MeteoGalicia no da rayos desde las ${new Date(feedStale.lastOkAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}`
          : 'MeteoGalicia no da rayos');
      }
      if (!fresh) {
        throw new Error(asOf != null ? 'Sin respuesta del servidor de rayos' : 'Sin datos de rayos: el servidor no responde');
      }
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

      setClusters(clusters);

      // gust front detection. Cross stations with active
      // clusters; flag those whose gust ratio + bearing alignment match an
      // outflow signature. Pulls station data via getState() (same pattern).
      const fronts = detectGustFronts(collectGustFrontReadings(), clusters);
      setGustFronts(fronts);

      const alert = computeStormAlert(strikes, clusters, prevAlertRef.current, centerLat, centerLon);
      setAlert(alert);
      prevAlertRef.current = alert;

      setRecentActivity(computeRecentActivity(strikes, centerLat, centerLon));

      setLastFetch(new Date(asOf ?? Date.now()));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error obteniendo rayos';
      setError(msg);
      console.error('[Lightning] Poll error:', err);

      // Exponential backoff retry (5s, 15s, 45s) — max 3 retries per poll cycle
      if (retryCountRef.current < 3) {
        const delay = 5000 * Math.pow(3, retryCountRef.current);
        retryCountRef.current++;
        console.log(`[Lightning] Retry ${retryCountRef.current}/3 in ${delay / 1000}s`);
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = undefined;
          fetchAndUpdate();
        }, delay);
      }
    } finally {
      setLoading(false);
    }
  }, [setStrikes, setAlert, setClusters, setClusterHistory, setGustFronts, setLoading, setError, setLastFetch, setRecentActivity, sectorCenter, stormActive]);

  // Visibility-aware polling — pauses when tab is hidden.
  // Adaptive cadence: 60 s during active storms (count5m≥1 within WATCH_KM),
  // 2 min otherwise. Combined with the matching cache-TTL drop in
  // lightningClient.ts this brings worst-case render lag from ~4 min → ~1.5 min
  // during the moments that matter, without burning extra calls when quiet.
  const pollInterval = stormActive ? POLL_INTERVAL_STORM_MS : POLL_INTERVAL_NORMAL_MS;
  useVisibilityPolling(fetchAndUpdate, pollInterval);
}
