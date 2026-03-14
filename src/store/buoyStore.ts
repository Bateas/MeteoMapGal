/**
 * Zustand store for marine buoy data (Puertos del Estado).
 * Shared between BuoyPanel (sidebar) and BuoyMarker (map).
 * Only active when sector is 'rias'.
 */
import { create } from 'zustand';
import type { BuoyReading } from '../api/buoyClient';

/** SST snapshot for history buffer */
export interface SSTSnapshot {
  time: number; // Date.now()
  waterTemp: number;
  windSpeed: number | null;
  windDir: number | null;
}

const SST_HISTORY_MAX_AGE_MS = 24 * 3600_000; // Keep 24h of history

interface BuoyState {
  buoys: BuoyReading[];
  loading: boolean;
  error: string | null;
  selectedBuoyId: number | null;
  lastFetch: number;
  /** SST history buffer: buoyId → time-ordered snapshots (last 24h) */
  sstHistory: Map<number, SSTSnapshot[]>;
}

interface BuoyActions {
  setBuoys: (buoys: BuoyReading[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  selectBuoy: (id: number | null) => void;
}

export const useBuoyStore = create<BuoyState & BuoyActions>((set, get) => ({
  buoys: [],
  loading: false,
  error: null,
  selectedBuoyId: null,
  lastFetch: 0,
  sstHistory: new Map(),

  setBuoys: (buoys) => {
    // Append current waterTemp to SST history buffer
    const now = Date.now();
    const cutoff = now - SST_HISTORY_MAX_AGE_MS;
    const history = new Map(get().sstHistory);

    for (const b of buoys) {
      if (b.waterTemp === null) continue;
      const existing = history.get(b.stationId) ?? [];
      // Prune old entries + append new
      const pruned = existing.filter((s) => s.time > cutoff);
      pruned.push({
        time: now,
        waterTemp: b.waterTemp,
        windSpeed: b.windSpeed,
        windDir: b.windDir,
      });
      history.set(b.stationId, pruned);
    }

    set({ buoys, loading: false, error: null, lastFetch: now, sstHistory: history });
  },
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  selectBuoy: (id) => set({ selectedBuoyId: id }),
}));
