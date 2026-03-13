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

interface SpotState {
  /** Currently selected spot ID */
  activeSpotId: string;
  /** Resolved spot object */
  activeSpot: SailingSpot;
  /** Per-spot scoring results (keyed by spot.id) */
  scores: Map<string, SpotScore>;
  /** Last scoring computation timestamp */
  lastScored: number;
  /** Per-spot sailing window results (keyed by spot.id) */
  sailingWindows: Map<string, SpotWindowResult>;
  /** Last sailing window computation timestamp */
  windowsFetchedAt: number;
}

interface SpotActions {
  selectSpot: (spotId: string) => void;
  setScores: (scores: Map<string, SpotScore>) => void;
  setSailingWindows: (windows: Map<string, SpotWindowResult>) => void;
}

export const useSpotStore = create<SpotState & SpotActions>()(
  devtools(
    persist(
      (set) => ({
        activeSpotId: DEFAULT_SPOT_ID,
        activeSpot: ALL_SPOTS.find((s) => s.id === DEFAULT_SPOT_ID)!,
        scores: new Map(),
        lastScored: 0,
        sailingWindows: new Map(),
        windowsFetchedAt: 0,

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

        setScores: (scores) =>
          set({ scores, lastScored: Date.now() }, undefined, 'setScores'),

        setSailingWindows: (sailingWindows) =>
          set({ sailingWindows, windowsFetchedAt: Date.now() }, undefined, 'setSailingWindows'),
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
