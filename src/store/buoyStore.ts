/**
 * Zustand store for marine buoy data (Puertos del Estado).
 * Shared between BuoyPanel (sidebar) and BuoySymbolLayer (map).
 * Only active when sector is 'rias'.
 */
import { create } from 'zustand';
import type { BuoyReading } from '../api/buoyClient';

interface BuoyState {
  buoys: BuoyReading[];
  /** Buoys of the list that have been silent for over 3 h, with their last reading. Drawn grey with
   *  «sin dato desde» (18-nov); nothing that computes reads them. */
  silentBuoys: BuoyReading[];
  loading: boolean;
  error: string | null;
  selectedBuoyId: number | null;
  lastFetch: number;
}

interface BuoyActions {
  setBuoys: (buoys: BuoyReading[]) => void;
  setSilentBuoys: (buoys: BuoyReading[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  selectBuoy: (id: number | null) => void;
}

export const useBuoyStore = create<BuoyState & BuoyActions>((set) => ({
  buoys: [],
  silentBuoys: [],
  loading: false,
  error: null,
  selectedBuoyId: null,
  lastFetch: 0,

  setBuoys: (buoys) => set({ buoys, loading: false, error: null, lastFetch: Date.now() }),
  setSilentBuoys: (silentBuoys) => set({ silentBuoys }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  selectBuoy: (id) => set({ selectedBuoyId: id }),
}));
