import { useEffect, useRef, useCallback } from 'react';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { fetchLightningStrikes, distanceKm } from '../api/lightningClient';
import { trackStorms } from '../services/stormTracker';
import type { StormCluster } from '../services/stormTracker';
import type { LightningStrike, StormAlert, StormAlertLevel } from '../types/lightning';
import type { ClusterSnapshot } from '../services/stormTracker';
import { MAP_CENTER } from '../config/constants';

/** Reservoir center (Castrelo de Miño) */
const RESERVOIR_LAT = MAP_CENTER[1]; // 42.29
const RESERVOIR_LON = MAP_CENTER[0]; // -8.1

/**
 * Alert distance thresholds (updated per user request):
 * - danger:  < 5 km  → storm overhead
 * - warning: < 25 km → storm approaching
 * - watch:   < 50 km → activity in the area
 */
const DANGER_KM = 5;
const WARNING_KM = 25;
const WATCH_KM = 50;

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
  /** Simulation mode: inject fake strikes for testing */
  simulationActive: boolean;

  setStrikes: (strikes: LightningStrike[]) => void;
  setAlert: (alert: StormAlert) => void;
  setClusters: (clusters: StormCluster[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setLastFetch: (date: Date) => void;
  toggleOverlay: () => void;
  toggleSimulation: () => void;
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
      simulationActive: false,

      setStrikes: (strikes) => set({ strikes }),
      setAlert: (alert) => set({ stormAlert: alert }),
      setClusters: (clusters) => set({ clusters }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setLastFetch: (date) => set({ lastFetch: date }),
      toggleOverlay: () => set({ showOverlay: !get().showOverlay }),
      toggleSimulation: () => set({ simulationActive: !get().simulationActive }),
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
): StormAlert {
  const now = Date.now();

  // Only recent strikes for alert evaluation
  const recent = strikes.filter(
    (s) => now - s.timestamp < RECENT_WINDOW_MS,
  );

  if (recent.length === 0) {
    return { ...NO_ALERT, updatedAt: new Date() };
  }

  // Distance of each recent strike to reservoir
  const distances = recent.map((s) =>
    distanceKm(s.lat, s.lon, RESERVOIR_LAT, RESERVOIR_LON),
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
// Simulation: generates a storm approaching from the south
// ---------------------------------------------------------------------------

let simStep = 0;

function generateSimulatedStrikes(): LightningStrike[] {
  const now = Date.now();
  simStep++;

  // Storm mass approaching from SSW, starting ~45km away, moving ~30 km/h NNE
  // Each step (2min) = ~1 km closer
  const baseDistKm = Math.max(3, 45 - simStep * 1.0);
  const baseBearing = 200; // approaching from SSW (bearing 200° from reservoir)
  const bearingRad = (baseBearing * Math.PI) / 180;

  // Convert bearing + distance to lat/lon offset
  const baseLat = RESERVOIR_LAT + (baseDistKm / 111.32) * Math.cos(bearingRad);
  const baseLon = RESERVOIR_LON + (baseDistKm / (111.32 * Math.cos((RESERVOIR_LAT * Math.PI) / 180))) * Math.sin(bearingRad);

  const strikes: LightningStrike[] = [];
  const clusterSize = 8 + Math.floor(Math.random() * 12); // 8-20 strikes per cluster

  for (let i = 0; i < clusterSize; i++) {
    // Scatter strikes within ~10km radius of cluster center
    const scatterKm = Math.random() * 10;
    const scatterAngle = Math.random() * 2 * Math.PI;
    const lat = baseLat + (scatterKm / 111.32) * Math.cos(scatterAngle);
    const lon = baseLon + (scatterKm / (111.32 * Math.cos((baseLat * Math.PI) / 180))) * Math.sin(scatterAngle);

    // Vary age: most recent within last 10 min, some older
    const ageMinutes = Math.floor(Math.random() * 30);
    const timestamp = now - ageMinutes * 60_000;

    strikes.push({
      id: 9000 + simStep * 100 + i,
      lat,
      lon,
      timestamp,
      peakCurrent: 20 + Math.floor(Math.random() * 180),
      cloudToCloud: Math.random() < 0.2,
      multiplicity: 1,
      ageMinutes,
    });
  }

  // Optional: secondary cluster further away (trailing cell)
  if (simStep > 5 && Math.random() < 0.7) {
    const trailDist = baseDistKm + 15 + Math.random() * 10;
    const trailBearing = baseBearing + (Math.random() - 0.5) * 30;
    const trailRad = (trailBearing * Math.PI) / 180;
    const trailLat = RESERVOIR_LAT + (trailDist / 111.32) * Math.cos(trailRad);
    const trailLon = RESERVOIR_LON + (trailDist / (111.32 * Math.cos((RESERVOIR_LAT * Math.PI) / 180))) * Math.sin(trailRad);

    for (let i = 0; i < 5; i++) {
      const sKm = Math.random() * 8;
      const sAngle = Math.random() * 2 * Math.PI;
      strikes.push({
        id: 8000 + simStep * 100 + i,
        lat: trailLat + (sKm / 111.32) * Math.cos(sAngle),
        lon: trailLon + (sKm / (111.32 * Math.cos((trailLat * Math.PI) / 180))) * Math.sin(sAngle),
        timestamp: now - Math.floor(Math.random() * 45) * 60_000,
        peakCurrent: 30 + Math.floor(Math.random() * 100),
        cloudToCloud: false,
        multiplicity: 1,
        ageMinutes: Math.floor(Math.random() * 45),
      });
    }
  }

  return strikes;
}

// ---------------------------------------------------------------------------
// Hook: polls lightning data and computes storm alerts
// ---------------------------------------------------------------------------

// Export the ClusterSnapshot type for stormTracker
export type { ClusterSnapshot };

export function useLightningData() {
  const {
    setStrikes,
    setAlert,
    setClusters,
    setLoading,
    setError,
    setLastFetch,
    stormAlert,
    simulationActive,
  } = useLightningStore();

  const prevAlertRef = useRef(stormAlert);
  const historyRef = useRef<ClusterSnapshot[]>([]);

  const fetchAndUpdate = useCallback(async () => {
    setLoading(true);
    try {
      let strikes: LightningStrike[];

      if (simulationActive) {
        strikes = generateSimulatedStrikes();
        console.log(`[Lightning] SIMULATION: ${strikes.length} fake strikes (step ${simStep})`);
      } else {
        strikes = await fetchLightningStrikes();
      }

      setStrikes(strikes);
      setError(null);

      // Track storm clusters with velocity vectors
      const { clusters, history } = trackStorms(
        strikes,
        historyRef.current,
        RESERVOIR_LAT,
        RESERVOIR_LON,
      );
      historyRef.current = history;
      setClusters(clusters);

      const alert = computeStormAlert(strikes, clusters, prevAlertRef.current);
      setAlert(alert);
      prevAlertRef.current = alert;

      setLastFetch(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error obteniendo rayos';
      setError(msg);
      console.error('[Lightning] Poll error:', err);
    } finally {
      setLoading(false);
    }
  }, [setStrikes, setAlert, setClusters, setLoading, setError, setLastFetch, simulationActive]);

  // Initial fetch + polling
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Reset simulation step when toggling
    if (simulationActive) simStep = 0;

    fetchAndUpdate();
    intervalRef.current = setInterval(fetchAndUpdate, simulationActive ? 3000 : POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAndUpdate, simulationActive]);
}
