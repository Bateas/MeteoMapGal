/**
 * Air Quality store — UV + PM2.5 for subtle badges/ticker.
 * NOT for overlays — regional data, same across whole sector.
 */

import { create } from 'zustand';
import type { AirQualityCurrent } from '../api/airQualityClient';

interface AirQualityState {
  data: AirQualityCurrent | null;
  setData: (data: AirQualityCurrent | null) => void;
}

export const useAirQualityStore = create<AirQualityState>((set) => ({
  data: null,
  setData: (data) => set({ data }),
}));
