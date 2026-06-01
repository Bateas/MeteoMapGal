/**
 * Store for user-created "chincheta" spots.
 *
 * Persists ONLY the pin locations (not the verdict — that is recomputed live
 * by `useUserSpotScoring`). Kept entirely separate from `spotStore` so user
 * spots never contaminate the official scoring/alerts pipeline (moat O3).
 */
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { SpotScore } from '../services/spotScoringEngine';
import {
  type UserSpot,
  MAX_USER_SPOTS,
  isInGalicia,
  sanitizeSpotName,
  makeUserSpotId,
  defaultUserSpotName,
} from '../config/userSpots';

interface UserSpotState {
  /** All user-created pins (persisted). */
  userSpots: UserSpot[];
  /** Currently open user-spot popup (transient — not persisted). */
  selectedUserSpotId: string | null;
  /** Live scores keyed by user spot id (recomputed, never persisted). */
  scores: Map<string, SpotScore>;
  lastScored: number;
}

interface UserSpotActions {
  /** Create a pin at [lon, lat] in the given sector. Returns the new spot, or
   *  null if rejected (out of Galicia, or cap reached). Auto-selects it. */
  addUserSpot: (lon: number, lat: number, sectorId: string) => UserSpot | null;
  removeUserSpot: (id: string) => void;
  renameUserSpot: (id: string, name: string) => void;
  selectUserSpot: (id: string | null) => void;
  setUserScores: (scores: Map<string, SpotScore>) => void;
}

export const useUserSpotStore = create<UserSpotState & UserSpotActions>()(
  devtools(
    persist(
      (set, get) => ({
        userSpots: [],
        selectedUserSpotId: null,
        scores: new Map(),
        lastScored: 0,

        addUserSpot: (lon, lat, sectorId) => {
          if (!isInGalicia(lon, lat)) return null;
          const existing = get().userSpots;
          if (existing.length >= MAX_USER_SPOTS) return null;

          let id = makeUserSpotId(Date.now());
          // Collision guard (two pins in the same ms) — append a short suffix.
          if (existing.some((u) => u.id === id)) {
            id = `${id}-${existing.length}`;
          }
          const spot: UserSpot = {
            id,
            name: defaultUserSpotName(existing.length),
            center: [lon, lat],
            sectorId,
            createdAt: Date.now(),
          };
          set(
            { userSpots: [...existing, spot], selectedUserSpotId: id },
            undefined,
            'addUserSpot',
          );
          return spot;
        },

        removeUserSpot: (id) => {
          const { userSpots, selectedUserSpotId, scores } = get();
          const nextScores = new Map(scores);
          nextScores.delete(id);
          set(
            {
              userSpots: userSpots.filter((u) => u.id !== id),
              selectedUserSpotId: selectedUserSpotId === id ? null : selectedUserSpotId,
              scores: nextScores,
            },
            undefined,
            'removeUserSpot',
          );
        },

        renameUserSpot: (id, name) => {
          const clean = sanitizeSpotName(name);
          if (!clean) return;
          set(
            {
              userSpots: get().userSpots.map((u) => (u.id === id ? { ...u, name: clean } : u)),
            },
            undefined,
            'renameUserSpot',
          );
        },

        selectUserSpot: (id) => set({ selectedUserSpotId: id }, undefined, 'selectUserSpot'),

        setUserScores: (scores) =>
          set({ scores, lastScored: Date.now() }, undefined, 'setUserScores'),
      }),
      {
        name: 'user-spot-store',
        // Persist ONLY the pin locations. scores is a Map (not serializable) and
        // must stay live; selection should not survive a reload.
        partialize: (state) => ({ userSpots: state.userSpots }),
      },
    ),
    { name: 'UserSpotStore' },
  ),
);
