/**
 * MeteoGalicia ICA store — official Galician air-quality readings.
 * Sector-agnostic (regional data, like fires + AEMET visibility).
 */

import { create } from 'zustand';
import type { IcaReading } from '../api/meteoGaliciaIcaClient';

interface IcaState {
  readings: IcaReading[];
  fetchedAt: number | null;
  setReadings: (readings: IcaReading[]) => void;
  clear: () => void;
}

export const useIcaStore = create<IcaState>((set) => ({
  readings: [],
  fetchedAt: null,
  setReadings: (readings) => set({ readings, fetchedAt: Date.now() }),
  clear: () => set({ readings: [], fetchedAt: null }),
}));
