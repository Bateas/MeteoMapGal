/**
 * Airspace store — caches ENAIRE data (UAS zones + NOTAMs).
 * Also stores the evaluated AirspaceCheck for the active sector.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { UasZone, ActiveNotam } from '../api/enaireClient';
import type { AirspaceCheck } from '../services/airspaceService';

interface AirspaceState {
  zones: UasZone[];
  notams: ActiveNotam[];
  check: AirspaceCheck | null;
  lastZoneFetch: number;
  lastNotamFetch: number;
  loading: boolean;
  error: string | null;

  setZones: (zones: UasZone[]) => void;
  setNotams: (notams: ActiveNotam[]) => void;
  setCheck: (check: AirspaceCheck) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useAirspaceStore = create<AirspaceState>()(
  devtools(
    (set) => ({
      zones: [],
      notams: [],
      check: null,
      lastZoneFetch: 0,
      lastNotamFetch: 0,
      loading: false,
      error: null,

      setZones: (zones) =>
        set({ zones, lastZoneFetch: Date.now() }, undefined, 'setZones'),

      setNotams: (notams) =>
        set({ notams, lastNotamFetch: Date.now() }, undefined, 'setNotams'),

      setCheck: (check) =>
        set({ check }, undefined, 'setCheck'),

      setLoading: (loading) =>
        set({ loading }, undefined, 'setLoading'),

      setError: (error) =>
        set({ error }, undefined, 'setError'),

      reset: () =>
        set({
          zones: [], notams: [], check: null,
          lastZoneFetch: 0, lastNotamFetch: 0,
          loading: false, error: null,
        }, undefined, 'reset'),
    }),
    { name: 'AirspaceStore' },
  ),
);
