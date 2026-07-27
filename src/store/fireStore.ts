/**
 * Active fire store — NASA FIRMS hotspots for Galicia + buffer.
 * Shared across both sectors (regional data, sector-agnostic).
 *
 * Sector-level severity is computed on the fly by aggregateFiresForSector
 * in services/fireService — no persistence needed here.
 */

import { create } from 'zustand';
import type { ActiveFire, FireWithAttribution } from '../types/fire';
import type { FireEvent } from '../api/fireEventsClient';

interface FireState {
  fires: ActiveFire[];
  /** Named EFFIS events — the same satellite data grouped by Copernicus into
   *  fires with a municipality and a burnt area. Complements the hotspots
   *  rather than replacing them: events carry a name but lag behind, hotspots
   *  are fast but anonymous. */
  events: FireEvent[];
  /** Fires our own strike history ties to lightning, keyed by fireAttributionKey.
   *  Only fires WITH an attribution are in here — a miss means "no known cause",
   *  never "no data". Empty whenever our database is unreachable. */
  attribution: Map<string, FireWithAttribution>;
  fetchedAt: number | null;
  setFires: (fires: ActiveFire[]) => void;
  setEvents: (events: FireEvent[]) => void;
  setAttribution: (attribution: Map<string, FireWithAttribution>) => void;
  clear: () => void;
}

export const useFireStore = create<FireState>((set) => ({
  fires: [],
  events: [],
  attribution: new Map(),
  fetchedAt: null,
  setFires: (fires) => set({ fires, fetchedAt: Date.now() }),
  setEvents: (events) => set({ events }),
  setAttribution: (attribution) => set({ attribution }),
  clear: () => set({ fires: [], events: [], attribution: new Map(), fetchedAt: null }),
}));
