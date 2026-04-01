/**
 * Aviation monitoring store — Embalse sector only.
 * Tracks aircraft positions, trajectories, and proximity alerts.
 */
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { Aircraft, AviationAlert } from '../types/aviation';

interface TrackPoint {
  lat: number;
  lon: number;
  altitude: number;
  timestamp: number;
}

interface AviationState {
  aircraft: Aircraft[];
  trajectories: Map<string, TrackPoint[]>; // keyed by icao24
  alert: AviationAlert;
  showOverlay: boolean;
  pollIntervalMs: number;
  isLoading: boolean;
  error: string | null;
  lastFetch: number | null;
  creditsUsed: number;

  setAircraft: (aircraft: Aircraft[]) => void;
  updateTrajectories: (aircraft: Aircraft[]) => void;
  setAlert: (alert: AviationAlert) => void;
  toggleOverlay: () => void;
  setPollInterval: (ms: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setLastFetch: (ts: number) => void;
  setCreditsUsed: (n: number) => void;
}

const MAX_TRACK_POINTS = 4; // ~4 polls at 90s = ~6min trail. More = huge lines at 800km/h
const STALE_MS = 5 * 60 * 1000;

const INITIAL_ALERT: AviationAlert = {
  level: 'none',
  nearestAircraft: null,
  aircraftInBbox: 0,
  aircraftClose: 0,
  updatedAt: Date.now(),
};

export const useAviationStore = create<AviationState>()(
  devtools(
    persist(
      (set, get) => ({
        aircraft: [],
        trajectories: new Map(),
        alert: INITIAL_ALERT,
        showOverlay: false,
        pollIntervalMs: 90_000,
        isLoading: false,
        error: null,
        lastFetch: null,
        creditsUsed: 0,

        setAircraft: (aircraft) => set({ aircraft }),

        updateTrajectories: (aircraft) => {
          const trajectories = new Map(get().trajectories);
          const now = Date.now();
          const activeIds = new Set<string>();

          for (const ac of aircraft) {
            activeIds.add(ac.icao24);
            const existing = trajectories.get(ac.icao24) || [];
            const last = existing[existing.length - 1];
            // Only add if moved >100m
            if (last) {
              const dlat = (ac.lat - last.lat) * 111_320;
              const dlon = (ac.lon - last.lon) * 111_320 * Math.cos(ac.lat * Math.PI / 180);
              if (Math.sqrt(dlat * dlat + dlon * dlon) < 100) continue;
            }
            trajectories.set(ac.icao24, [
              ...existing.slice(-(MAX_TRACK_POINTS - 1)),
              { lat: ac.lat, lon: ac.lon, altitude: ac.altitude, timestamp: now },
            ]);
          }

          // Prune stale tracks
          for (const [id, points] of trajectories) {
            if (!activeIds.has(id) && now - points[points.length - 1].timestamp > STALE_MS) {
              trajectories.delete(id);
            }
          }

          set({ trajectories });
        },

        setAlert: (alert) => set({ alert }),
        toggleOverlay: () => set((s) => ({ showOverlay: !s.showOverlay })),
        setPollInterval: (pollIntervalMs) => set({ pollIntervalMs }),
        setLoading: (isLoading) => set({ isLoading }),
        setError: (error) => set({ error }),
        setLastFetch: (lastFetch) => set({ lastFetch }),
        setCreditsUsed: (creditsUsed) => set({ creditsUsed }),
      }),
      {
        name: 'aviation-store',
        partialize: (s) => ({ showOverlay: s.showOverlay }),
      },
    ),
    { name: 'AviationStore' },
  ),
);
