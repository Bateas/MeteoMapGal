/**
 * AIS ship tracking store.
 * Independent toggle (not part of WeatherLayerType) — ships can overlay weather layers.
 */
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { Vessel, TrajectoryPoint } from '../types/ais';

interface AISState {
  vessels: Map<number, Vessel>;
  trajectories: Map<number, TrajectoryPoint[]>;
  showOverlay: boolean;
  isConnected: boolean;
  error: string | null;

  upsertVessel: (vessel: Vessel) => void;
  addTrajectoryPoint: (mmsi: number, point: TrajectoryPoint) => void;
  pruneStale: (maxAgeMs?: number) => void;
  toggleOverlay: () => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const MAX_TRAJECTORY_POINTS = 20;
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export const useAISStore = create<AISState>()(
  devtools(
    persist(
      (set, get) => ({
        vessels: new Map(),
        trajectories: new Map(),
        showOverlay: false,
        isConnected: false,
        error: null,

        upsertVessel: (vessel) => {
          const vessels = new Map(get().vessels);
          vessels.set(vessel.mmsi, vessel);
          set({ vessels });
        },

        addTrajectoryPoint: (mmsi, point) => {
          const trajectories = new Map(get().trajectories);
          const existing = trajectories.get(mmsi) || [];
          // Only add if position moved >10m from last point
          const last = existing[existing.length - 1];
          if (last) {
            const dlat = (point.lat - last.lat) * 111_320;
            const dlon = (point.lon - last.lon) * 111_320 * Math.cos(point.lat * Math.PI / 180);
            if (Math.sqrt(dlat * dlat + dlon * dlon) < 10) return;
          }
          trajectories.set(mmsi, [...existing.slice(-(MAX_TRAJECTORY_POINTS - 1)), point]);
          set({ trajectories });
        },

        pruneStale: (maxAgeMs = STALE_THRESHOLD_MS) => {
          const now = Date.now();
          const vessels = new Map(get().vessels);
          const trajectories = new Map(get().trajectories);
          let changed = false;
          for (const [mmsi, v] of vessels) {
            if (now - v.lastUpdate > maxAgeMs) {
              vessels.delete(mmsi);
              trajectories.delete(mmsi);
              changed = true;
            }
          }
          if (changed) set({ vessels, trajectories });
        },

        toggleOverlay: () => set((s) => ({ showOverlay: !s.showOverlay })),
        setConnected: (isConnected) => set({ isConnected }),
        setError: (error) => set({ error }),
        reset: () => set({
          vessels: new Map(),
          trajectories: new Map(),
          isConnected: false,
          error: null,
        }),
      }),
      {
        name: 'ais-store',
        partialize: (s) => ({ showOverlay: s.showOverlay }),
      },
    ),
    { name: 'AISStore' },
  ),
);
