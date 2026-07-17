/**
 * Active fire store — NASA FIRMS hotspots for Galicia + buffer.
 * Shared across both sectors (regional data, sector-agnostic).
 *
 * Sector-level severity is computed on the fly by aggregateFiresForSector
 * in services/fireService — no persistence needed here.
 */

import { create } from 'zustand';
import type { ActiveFire, FireWithAttribution } from '../types/fire';

interface FireState {
  fires: ActiveFire[];
  /** Fires our own strike history ties to lightning, keyed by fireAttributionKey.
   *  Only fires WITH an attribution are in here — a miss means "no known cause",
   *  never "no data". Empty whenever our database is unreachable. */
  attribution: Map<string, FireWithAttribution>;
  fetchedAt: number | null;
  setFires: (fires: ActiveFire[]) => void;
  setAttribution: (attribution: Map<string, FireWithAttribution>) => void;
  clear: () => void;
}

export const useFireStore = create<FireState>((set) => ({
  fires: [],
  attribution: new Map(),
  fetchedAt: null,
  setFires: (fires) => set({ fires, fetchedAt: Date.now() }),
  setAttribution: (attribution) => set({ attribution }),
  clear: () => set({ fires: [], attribution: new Map(), fetchedAt: null }),
}));
