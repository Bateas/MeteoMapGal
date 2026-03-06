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

// ── Shallow-compare a reading to detect real changes ────────
// Returns true if the reading has different data from the existing one.
function readingChanged(prev: NormalizedReading | undefined, next: NormalizedReading): boolean {
  if (!prev) return true;
  // Fast path: same timestamp = same data (readings are immutable per fetch)
  if (prev.timestamp.getTime() === next.timestamp.getTime()) return false;
  return true;
}

interface WeatherState {
  // Data
  stations: NormalizedStation[];
  currentReadings: Map<string, NormalizedReading>;
  readingHistory: Map<string, NormalizedReading[]>;

  // Epoch counter — increments only when readings actually change.
  // Components can use this for cheap change detection.
  readingsEpoch: number;

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
  appendHistory: (readings: NormalizedReading[]) => void;
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
  readingsEpoch: 0,
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
        readingsEpoch: 0,
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
    // ── PERF: Skip entirely if nothing to update ──
    if (readings.length === 0) {
      set({ lastFetchTime: new Date() }, undefined, 'updateReadings/empty');
      return;
    }

    const { currentReadings, readingHistory, readingsEpoch } = get();

    // ── PERF: Only create new Maps if at least one reading actually changed ──
    // First pass: detect changes without allocating new Maps
    let hasChanges = false;
    for (const reading of readings) {
      if (readingChanged(currentReadings.get(reading.stationId), reading)) {
        hasChanges = true;
        break;
      }
    }

    if (!hasChanges) {
      // Readings are identical — only update fetch timestamp, no Map mutation
      set({ lastFetchTime: new Date() }, undefined, 'updateReadings/noChange');
      return;
    }

    // ── Something changed: create new Maps (mutate-then-set pattern) ──
    const newCurrent = new Map(currentReadings);
    const newHistory = new Map(readingHistory);
    let historyChanged = false;

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
        historyChanged = true;
      }
    }

    set({
      currentReadings: newCurrent,
      ...(historyChanged ? { readingHistory: newHistory } : {}),
      readingsEpoch: readingsEpoch + 1,
      lastFetchTime: new Date(),
    }, undefined, 'updateReadings');
  },

  // Append readings to history only (for model/interpolated data like Open-Meteo).
  // Never touches currentReadings — real-time station data stays untouched.
  appendHistory: (readings) => {
    if (readings.length === 0) return;

    const { readingHistory } = get();
    const newHistory = new Map(readingHistory);
    let changed = false;

    for (const reading of readings) {
      const history = newHistory.get(reading.stationId) || [];
      const exists = history.some(
        (h) => h.timestamp.getTime() === reading.timestamp.getTime()
      );
      if (!exists) {
        history.push(reading);
        if (history.length > MAX_HISTORY_ENTRIES) {
          history.splice(0, history.length - MAX_HISTORY_ENTRIES);
        }
        newHistory.set(reading.stationId, history);
        changed = true;
      }
    }

    if (changed) {
      set({ readingHistory: newHistory }, undefined, 'appendHistory');
    }
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
