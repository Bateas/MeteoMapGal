/**
 * Air Quality store — zone-based environmental data.
 *
 * Decoupled from spots: stores UV, PM2.5, PM10, AQI, pollen
 * per sector. Overlays and spots read from here independently.
 */

import { create } from 'zustand';
import type { AirQualityCurrent, AirQualityData } from '../api/airQualityClient';

interface AirQualityState {
  /** Current snapshot per sector */
  current: Record<string, AirQualityCurrent | null>;
  /** 48h hourly forecast per sector */
  hourly: Record<string, AirQualityData[]>;
  /** Last fetch timestamp */
  lastFetched: number;

  setCurrent: (sectorId: string, data: AirQualityCurrent) => void;
  setHourly: (sectorId: string, data: AirQualityData[]) => void;
}

export const useAirQualityStore = create<AirQualityState>()((set) => ({
  current: {},
  hourly: {},
  lastFetched: 0,

  setCurrent: (sectorId, data) =>
    set((s) => ({
      current: { ...s.current, [sectorId]: data },
      lastFetched: Date.now(),
    })),

  setHourly: (sectorId, data) =>
    set((s) => ({
      hourly: { ...s.hourly, [sectorId]: data },
    })),
}));
