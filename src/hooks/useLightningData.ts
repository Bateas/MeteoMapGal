import { useEffect, useRef, useCallback } from 'react';
import { create } from 'zustand';
import { fetchLightningStrikes, distanceKm } from '../api/lightningClient';
import type { LightningStrike, StormAlert, StormAlertLevel } from '../types/lightning';
import { MAP_CENTER } from '../config/constants';

/** Reservoir center (Castrelo de Miño) */
const RESERVOIR_LAT = MAP_CENTER[1]; // 42.29
const RESERVOIR_LON = MAP_CENTER[0]; // -8.1

/** Alert distance thresholds in km */
const DANGER_KM = 10;
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
  lastFetch: Date | null;
  isLoading: boolean;
  error: string | null;
  showOverlay: boolean;

  setStrikes: (strikes: LightningStrike[]) => void;
  setAlert: (alert: StormAlert) => void;
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
  updatedAt: new Date(),
};

export const useLightningStore = create<LightningState>((set, get) => ({
  strikes: [],
  stormAlert: NO_ALERT,
  lastFetch: null,
  isLoading: false,
  error: null,
  showOverlay: true,

  setStrikes: (strikes) => set({ strikes }),
  setAlert: (alert) => set({ stormAlert: alert }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setLastFetch: (date) => set({ lastFetch: date }),
  toggleOverlay: () => set({ showOverlay: !get().showOverlay }),
}));

// ---------------------------------------------------------------------------
// Alert computation
// ---------------------------------------------------------------------------

function computeStormAlert(
  strikes: LightningStrike[],
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
  const nearestKm = Math.min(...distances);

  // Determine alert level
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
    if (delta < -3) trend = 'approaching';
    else if (delta > 3) trend = 'receding';
  } else if (nearestKm < Infinity && previousAlert.nearestKm === Infinity) {
    trend = 'approaching';
  }

  return {
    level,
    nearestKm: Math.round(nearestKm * 10) / 10,
    recentCount,
    trend,
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Hook: polls lightning data and computes storm alerts
// ---------------------------------------------------------------------------

export function useLightningData() {
  const {
    setStrikes,
    setAlert,
    setLoading,
    setError,
    setLastFetch,
    stormAlert,
  } = useLightningStore();

  const prevAlertRef = useRef(stormAlert);

  const fetchAndUpdate = useCallback(async () => {
    setLoading(true);
    try {
      const strikes = await fetchLightningStrikes();
      setStrikes(strikes);
      setError(null);

      const alert = computeStormAlert(strikes, prevAlertRef.current);
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
  }, [setStrikes, setAlert, setLoading, setError, setLastFetch]);

  // Initial fetch + polling
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchAndUpdate();
    intervalRef.current = setInterval(fetchAndUpdate, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAndUpdate]);
}
