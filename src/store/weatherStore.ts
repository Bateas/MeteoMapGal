import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import { MAX_HISTORY_ENTRIES } from '../config/constants';
import { useWeatherSelectionStore } from './weatherSelectionStore';

export type WeatherSource = 'aemet' | 'meteogalicia' | 'meteoclimatic' | 'wunderground' | 'netatmo' | 'skyx';

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

  // Epoch counters — increment only when data actually changes.
  // Components can use these for cheap change detection instead of Map references.
  readingsEpoch: number;
  historyEpoch: number;

  // Status
  lastFetchTime: Date | null;
  isLoading: boolean;
  error: string | null;
  sourceFreshness: Map<WeatherSource, SourceStatus>;

  /** True when displaying cached/stale data before fresh fetch completes */
  isUsingCachedData: boolean;

  // Actions
  setStations: (stations: NormalizedStation[]) => void;
  updateReadings: (readings: NormalizedReading[]) => void;
  appendHistory: (readings: NormalizedReading[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  pruneHistory: () => void;
  updateSourceStatus: (source: WeatherSource, ok: boolean, count?: number, errorMsg?: string) => void;
  /** Persist current readings snapshot to localStorage for offline access */
  cacheSnapshot: () => void;
  /** Load cached readings from localStorage (returns true if cache was loaded) */
  loadFromCache: (sectorId: string) => boolean;
}

// ── Offline cache helpers ────────────────────────────────────
const CACHE_KEY_PREFIX = 'meteomap-readings-';
const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour — stale beyond this

// ── PERF: Throttle cacheSnapshot to avoid serializing 90+ station readings
// on every updateReadings() call (~5 sources × 5min = 5 calls per cycle).
// Instead, cache at most every 30s.
let _cacheSnapshotTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleCacheSnapshot(fn: () => void): void {
  if (_cacheSnapshotTimer !== null) return; // already scheduled
  _cacheSnapshotTimer = setTimeout(() => {
    _cacheSnapshotTimer = null;
    fn();
  }, 30_000); // 30 seconds
}

interface CachedSnapshot {
  stations: NormalizedStation[];
  readings: Array<{ stationId: string; data: NormalizedReading }>;
  savedAt: number; // epoch ms
}

function serializeReadings(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
): string {
  const snapshot: CachedSnapshot = {
    stations,
    readings: [...readings.entries()].map(([id, r]) => ({
      stationId: id,
      data: { ...r, timestamp: r.timestamp as unknown as Date },
    })),
    savedAt: Date.now(),
  };
  return JSON.stringify(snapshot, (_key, val) =>
    val instanceof Date ? val.toISOString() : val,
  );
}

function deserializeReadings(json: string): CachedSnapshot | null {
  try {
    const raw = JSON.parse(json) as CachedSnapshot;
    // Revive Date objects
    for (const entry of raw.readings) {
      entry.data.timestamp = new Date(entry.data.timestamp as unknown as string);
    }
    return raw;
  } catch {
    return null;
  }
}

export const useWeatherStore = create<WeatherState>()(devtools((set, get) => ({
  stations: [],
  currentReadings: new Map(),
  readingHistory: new Map(),
  readingsEpoch: 0,
  historyEpoch: 0,
  lastFetchTime: null,
  isLoading: false,
  error: null,
  sourceFreshness: new Map(),
  isUsingCachedData: false,

  setStations: (stations) => {
    if (stations.length === 0) {
      // Sector switch: clear all stale data from previous sector
      set({
        stations,
        currentReadings: new Map(),
        readingHistory: new Map(),
        readingsEpoch: 0,
        historyEpoch: 0,
        sourceFreshness: new Map(),
      }, undefined, 'setStations/reset');
      // Reset selection state in the dedicated selection store
      useWeatherSelectionStore.getState().resetSelection();
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

    const { historyEpoch } = get();
    set({
      currentReadings: newCurrent,
      ...(historyChanged ? { readingHistory: newHistory, historyEpoch: historyEpoch + 1 } : {}),
      readingsEpoch: readingsEpoch + 1,
      lastFetchTime: new Date(),
      isUsingCachedData: false,
    }, undefined, 'updateReadings');

    // Auto-cache after successful fresh update (throttled — at most every 30s)
    scheduleCacheSnapshot(() => get().cacheSnapshot());
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

  setLoading: (isLoading) => set({ isLoading }, undefined, 'setLoading'),
  setError: (error) => set({ error }, undefined, 'setError'),

  pruneHistory: () => {
    const { readingHistory } = get();
    const cutoff = Date.now() - 48 * 60 * 60 * 1000; // 48h ago (matches MAX_HISTORY_ENTRIES)
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
  // ── Offline cache ─────────────────────────────────────────
  cacheSnapshot: () => {
    const { stations, currentReadings } = get();
    if (stations.length === 0 || currentReadings.size === 0) return;
    try {
      // Detect sector from station prefix patterns
      const sectorId = stations[0]?.id?.startsWith('rias_') ? 'rias' : 'embalse';
      const key = CACHE_KEY_PREFIX + sectorId;
      localStorage.setItem(key, serializeReadings(stations, currentReadings));
    } catch {
      // localStorage full or unavailable — ignore silently
    }
  },

  loadFromCache: (sectorId: string) => {
    try {
      const key = CACHE_KEY_PREFIX + sectorId;
      const raw = localStorage.getItem(key);
      if (!raw) return false;

      const snapshot = deserializeReadings(raw);
      if (!snapshot) return false;

      // Skip if cache is too old (>1h)
      if (Date.now() - snapshot.savedAt > CACHE_MAX_AGE_MS) {
        localStorage.removeItem(key);
        return false;
      }

      const cachedReadings = new Map<string, NormalizedReading>();
      for (const entry of snapshot.readings) {
        cachedReadings.set(entry.stationId, entry.data);
      }

      set({
        stations: snapshot.stations,
        currentReadings: cachedReadings,
        lastFetchTime: new Date(snapshot.savedAt),
        isUsingCachedData: true,
      }, undefined, 'loadFromCache');

      return true;
    } catch {
      return false;
    }
  },
}), { name: 'WeatherStore' }));

// Re-export selection store for discoverability
export { useWeatherSelectionStore } from './weatherSelectionStore';
