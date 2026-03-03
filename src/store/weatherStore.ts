import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import { MAX_HISTORY_ENTRIES } from '../config/constants';

export type WeatherSource = 'aemet' | 'meteogalicia' | 'meteoclimatic' | 'wunderground' | 'netatmo';

export interface SourceStatus {
  lastSuccess: Date | null;
  lastError: Date | null;
  errorMessage: string | null;
  readingCount: number;
}

interface WeatherState {
  // Data
  stations: NormalizedStation[];
  currentReadings: Map<string, NormalizedReading>;
  readingHistory: Map<string, NormalizedReading[]>;

  // UI state
  selectedStationId: string | null;
  highlightedStationId: string | null;
  chartSelectedStations: string[];

  // Status
  lastFetchTime: Date | null;
  isLoading: boolean;
  error: string | null;
  sourceFreshness: Map<WeatherSource, SourceStatus>;

  // Actions
  setStations: (stations: NormalizedStation[]) => void;
  updateReadings: (readings: NormalizedReading[]) => void;
  selectStation: (id: string | null) => void;
  highlightStation: (id: string | null) => void;
  toggleChartStation: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  pruneHistory: () => void;
  updateSourceStatus: (source: WeatherSource, ok: boolean, count?: number, errorMsg?: string) => void;
}

export const useWeatherStore = create<WeatherState>()(devtools((set, get) => ({
  stations: [],
  currentReadings: new Map(),
  readingHistory: new Map(),
  selectedStationId: null,
  highlightedStationId: null,
  chartSelectedStations: [],
  lastFetchTime: null,
  isLoading: false,
  error: null,
  sourceFreshness: new Map(),

  setStations: (stations) => {
    if (stations.length === 0) {
      // Sector switch: clear all stale data from previous sector
      set({
        stations,
        currentReadings: new Map(),
        readingHistory: new Map(),
        selectedStationId: null,
        highlightedStationId: null,
        chartSelectedStations: [],
        sourceFreshness: new Map(),
      }, undefined, 'setStations/reset');
    } else {
      set({ stations }, undefined, 'setStations');
    }
  },

  updateReadings: (readings) => {
    const { currentReadings, readingHistory } = get();
    const newCurrent = new Map(currentReadings);
    const newHistory = new Map(readingHistory);

    for (const reading of readings) {
      newCurrent.set(reading.stationId, reading);

      // Append to history, dedup by timestamp
      const history = newHistory.get(reading.stationId) || [];
      const exists = history.some(
        (h) => h.timestamp.getTime() === reading.timestamp.getTime()
      );
      if (!exists) {
        history.push(reading);
        // Cap at max entries, remove oldest
        if (history.length > MAX_HISTORY_ENTRIES) {
          history.splice(0, history.length - MAX_HISTORY_ENTRIES);
        }
        newHistory.set(reading.stationId, history);
      }
    }

    set({
      currentReadings: newCurrent,
      readingHistory: newHistory,
      lastFetchTime: new Date(),
    }, undefined, 'updateReadings');
  },

  selectStation: (id) => set({ selectedStationId: id }, undefined, 'selectStation'),
  highlightStation: (id) => set({ highlightedStationId: id }, undefined, 'highlightStation'),

  toggleChartStation: (id) => {
    const { chartSelectedStations } = get();
    const index = chartSelectedStations.indexOf(id);
    if (index >= 0) {
      set({ chartSelectedStations: chartSelectedStations.filter((s) => s !== id) }, undefined, 'toggleChartStation');
    } else {
      set({ chartSelectedStations: [...chartSelectedStations, id] }, undefined, 'toggleChartStation');
    }
  },

  setLoading: (isLoading) => set({ isLoading }, undefined, 'setLoading'),
  setError: (error) => set({ error }, undefined, 'setError'),

  pruneHistory: () => {
    const { readingHistory } = get();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h ago
    const newHistory = new Map<string, NormalizedReading[]>();
    let pruned = 0;
    for (const [id, entries] of readingHistory) {
      const fresh = entries.filter((r) => r.timestamp.getTime() > cutoff);
      if (fresh.length > 0) newHistory.set(id, fresh);
      pruned += entries.length - fresh.length;
    }
    if (pruned > 0) {
      set({ readingHistory: newHistory }, undefined, 'pruneHistory');
    }
  },

  updateSourceStatus: (source, ok, count = 0, errorMsg) => {
    const { sourceFreshness } = get();
    const newMap = new Map(sourceFreshness);
    const prev = newMap.get(source) ?? { lastSuccess: null, lastError: null, errorMessage: null, readingCount: 0 };
    if (ok) {
      newMap.set(source, { ...prev, lastSuccess: new Date(), readingCount: count, lastError: prev.lastError, errorMessage: null });
    } else {
      newMap.set(source, { ...prev, lastError: new Date(), errorMessage: errorMsg ?? 'Error' });
    }
    set({ sourceFreshness: newMap }, undefined, 'updateSourceStatus');
  },
}), { name: 'WeatherStore' }));
