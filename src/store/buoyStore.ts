/**
 * Zustand store for marine buoy data (Puertos del Estado).
 * Shared between BuoyPanel (sidebar) and BuoyMarker (map).
 * Only active when sector is 'rias'.
 */
import { create } from 'zustand';
import type { BuoyReading } from '../api/buoyClient';

interface BuoyState {
  buoys: BuoyReading[];
  loading: boolean;
  error: string | null;
  selectedBuoyId: number | null;
  lastFetch: number;
}

interface BuoyActions {
  setBuoys: (buoys: BuoyReading[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  selectBuoy: (id: number | null) => void;
}

export const useBuoyStore = create<BuoyState & BuoyActions>((set) => ({
  buoys: [],
  loading: false,
  error: null,
  selectedBuoyId: null,
  lastFetch: 0,

  setBuoys: (buoys) => set({ buoys, loading: false, error: null, lastFetch: Date.now() }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  selectBuoy: (id) => set({ selectedBuoyId: id }),
}));
