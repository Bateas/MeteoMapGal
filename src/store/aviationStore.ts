/**
 * Aviation monitoring store — Embalse sector only.
 * Tracks aircraft positions and proximity alerts.
 */
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { Aircraft, AviationAlert } from '../types/aviation';

interface AviationState {
  aircraft: Aircraft[];
  alert: AviationAlert;
  showOverlay: boolean;
  pollIntervalMs: number;
  isLoading: boolean;
  error: string | null;
  lastFetch: number | null;
  creditsUsed: number;

  setAircraft: (aircraft: Aircraft[]) => void;
  setAlert: (alert: AviationAlert) => void;
  toggleOverlay: () => void;
  setPollInterval: (ms: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setLastFetch: (ts: number) => void;
  setCreditsUsed: (n: number) => void;
}

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
      (set) => ({
        aircraft: [],
        alert: INITIAL_ALERT,
        showOverlay: false,
        pollIntervalMs: 60_000,
        isLoading: false,
        error: null,
        lastFetch: null,
        creditsUsed: 0,

        setAircraft: (aircraft) => set({ aircraft }),
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
