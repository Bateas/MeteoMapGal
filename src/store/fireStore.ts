/**
 * Active fire store — NASA FIRMS hotspots for Galicia + buffer.
 * Shared across both sectors (regional data, sector-agnostic).
 *
 * Sector-level severity is computed on the fly by aggregateFiresForSector
 * in services/fireService — no persistence needed here.
 */

import { create } from 'zustand';
import type { ActiveFire } from '../types/fire';

interface FireState {
  fires: ActiveFire[];
  fetchedAt: number | null;
  setFires: (fires: ActiveFire[]) => void;
  clear: () => void;
}

export const useFireStore = create<FireState>((set) => ({
  fires: [],
  fetchedAt: null,
  setFires: (fires) => set({ fires, fetchedAt: Date.now() }),
  clear: () => set({ fires: [], fetchedAt: null }),
}));
