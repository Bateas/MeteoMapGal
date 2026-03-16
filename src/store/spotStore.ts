/**
 * Zustand store for sailing spot selection (multi-sector).
 *
 * Tracks active spot, per-spot scoring results, and loading state.
 * Persisted to localStorage so spot selection survives page refresh.
 */
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { ALL_SPOTS, DEFAULT_SPOT_ID, type SailingSpot } from '../config/spots';
import type { SpotScore } from '../services/spotScoringEngine';
import type { SpotWindowResult } from '../services/sailingWindowService';
import type { ThermalPrecursorResult } from '../services/thermalPrecursorService';
import type { WebcamVisionResult } from '../services/webcamVisionService';
import type { HourlyForecast } from '../types/forecast';

/** Historical wind speed entry for sparkline */
export interface SpotWindSnapshot {
  ts: number;
  kt: number;
}

interface SpotState {
  /** Currently selected spot ID */
  activeSpotId: string;
  /** Resolved spot object */
  activeSpot: SailingSpot;
  /** Per-spot scoring results (keyed by spot.id) */
  scores: Map<string, SpotScore>;
  /** Last scoring computation timestamp */
  lastScored: number;
  /** Per-spot wind speed history for sparklines (keyed by spot.id, last ~2h) */
  windHistory: Map<string, SpotWindSnapshot[]>;
  /** Per-spot sailing window results (keyed by spot.id) */
  sailingWindows: Map<string, SpotWindowResult>;
  /** Last sailing window computation timestamp */
  windowsFetchedAt: number;
  /** Raw sector forecast (for forecast vs observation delta) */
  sectorForecast: HourlyForecast[];
  /** Per-spot thermal precursor results (keyed by spot.id) */
  thermalPrecursors: Map<string, ThermalPrecursorResult>;
  /** Last thermal precursor computation timestamp */
  precursorsFetchedAt: number;
  /** Per-spot webcam vision results (keyed by spot.id) */
  webcamVision: Map<string, WebcamVisionResult>;
  /** Last webcam vision analysis timestamp */
  visionAnalyzedAt: number;
}

interface SpotActions {
  selectSpot: (spotId: string) => void;
  setScores: (scores: Map<string, SpotScore>) => void;
  setSailingWindows: (windows: Map<string, SpotWindowResult>) => void;
  setSectorForecast: (forecast: HourlyForecast[]) => void;
  setThermalPrecursors: (precursors: Map<string, ThermalPrecursorResult>) => void;
  setWebcamVision: (results: Map<string, WebcamVisionResult>) => void;
}

export const useSpotStore = create<SpotState & SpotActions>()(
  devtools(
    persist(
      (set) => ({
        activeSpotId: DEFAULT_SPOT_ID,
        activeSpot: ALL_SPOTS.find((s) => s.id === DEFAULT_SPOT_ID)!,
        scores: new Map(),
        lastScored: 0,
        windHistory: new Map(),
        sailingWindows: new Map(),
        windowsFetchedAt: 0,
        sectorForecast: [],
        thermalPrecursors: new Map(),
        precursorsFetchedAt: 0,
        webcamVision: new Map(),
        visionAnalyzedAt: 0,

        selectSpot: (spotId: string) => {
          // Empty string = deselect (close popup, keep last activeSpot for reference)
          if (!spotId) {
            set({ activeSpotId: '' }, undefined, 'deselectSpot');
            return;
          }
          const spot = ALL_SPOTS.find((s) => s.id === spotId);
          if (!spot) return;
          set({ activeSpotId: spotId, activeSpot: spot }, undefined, 'selectSpot');
        },

        setScores: (scores) => {
          const now = Date.now();
          const MAX_HISTORY = 24; // ~2h at 5min intervals
          const prev = useSpotStore.getState().windHistory;
          const next = new Map(prev);
          for (const [spotId, sc] of scores) {
            if (sc.wind) {
              const arr = next.get(spotId) ?? [];
              // Avoid duplicate if scored within 60s of last entry
              if (arr.length === 0 || now - arr[arr.length - 1].ts > 60_000) {
                const updated = [...arr, { ts: now, kt: sc.wind.avgSpeedKt }];
                next.set(spotId, updated.length > MAX_HISTORY ? updated.slice(-MAX_HISTORY) : updated);
              }
            }
          }
          set({ scores, lastScored: now, windHistory: next }, undefined, 'setScores');
        },

        setSailingWindows: (sailingWindows) =>
          set({ sailingWindows, windowsFetchedAt: Date.now() }, undefined, 'setSailingWindows'),

        setSectorForecast: (sectorForecast) =>
          set({ sectorForecast }, undefined, 'setSectorForecast'),

        setThermalPrecursors: (thermalPrecursors) =>
          set({ thermalPrecursors, precursorsFetchedAt: Date.now() }, undefined, 'setThermalPrecursors'),

        setWebcamVision: (webcamVision) =>
          set({ webcamVision, visionAnalyzedAt: Date.now() }, undefined, 'setWebcamVision'),
      }),
      {
        name: 'spot-store',
        partialize: (state) => ({ activeSpotId: state.activeSpotId }),
      },
    ),
    { name: 'SpotStore' },
  ),
);

// Rehydrate activeSpot from persisted activeSpotId
const persisted = useSpotStore.getState();
const match = ALL_SPOTS.find((s) => s.id === persisted.activeSpotId);
if (match && match.id !== persisted.activeSpot.id) {
  useSpotStore.setState({ activeSpot: match });
}
