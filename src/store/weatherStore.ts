import { create } from 'zustand';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import { MAX_HISTORY_ENTRIES } from '../config/constants';

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

  // Actions
  setStations: (stations: NormalizedStation[]) => void;
  updateReadings: (readings: NormalizedReading[]) => void;
  selectStation: (id: string | null) => void;
  highlightStation: (id: string | null) => void;
  toggleChartStation: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useWeatherStore = create<WeatherState>((set, get) => ({
  stations: [],
  currentReadings: new Map(),
  readingHistory: new Map(),
  selectedStationId: null,
  highlightedStationId: null,
  chartSelectedStations: [],
  lastFetchTime: null,
  isLoading: false,
  error: null,

  setStations: (stations) => set({ stations }),

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
    });
  },

  selectStation: (id) => set({ selectedStationId: id }),
  highlightStation: (id) => set({ highlightedStationId: id }),

  toggleChartStation: (id) => {
    const { chartSelectedStations } = get();
    const index = chartSelectedStations.indexOf(id);
    if (index >= 0) {
      set({ chartSelectedStations: chartSelectedStations.filter((s) => s !== id) });
    } else {
      set({ chartSelectedStations: [...chartSelectedStations, id] });
    }
  },

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
