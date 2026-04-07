/**
 * useWarnings — Fetches MeteoGalicia adverse weather warnings periodically.
 *
 * Polls every 15 minutes (visibility-aware). Stores warnings in Zustand
 * for consumption by:
 * - stormPredictor (signal #8: official MG warning)
 * - FieldDrawer (warning display section)
 * - ConditionsTicker (warning ticker item)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { fetchMGWarnings, getWarningsForSector, type MGWarning } from '../api/mgWarningsClient';
import { useSectorStore } from '../store/sectorStore';
import { useVisibilityPolling } from './useVisibilityPolling';
import { useCallback } from 'react';

// ── Store ────────────────────────────────────────────────

interface WarningsState {
  /** All warnings from MG RSS */
  allWarnings: MGWarning[];
  /** Warnings filtered for current sector */
  sectorWarnings: MGWarning[];
  /** Last successful fetch time */
  lastFetch: Date | null;
  /** Loading state */
  isLoading: boolean;

  setWarnings: (all: MGWarning[], sector: MGWarning[]) => void;
  setLoading: (v: boolean) => void;
  setLastFetch: (d: Date) => void;
}

export const useWarningsStore = create<WarningsState>()(
  devtools(
    (set) => ({
      allWarnings: [],
      sectorWarnings: [],
      lastFetch: null,
      isLoading: false,

      setWarnings: (allWarnings, sectorWarnings) => set({ allWarnings, sectorWarnings }),
      setLoading: (isLoading) => set({ isLoading }),
      setLastFetch: (lastFetch) => set({ lastFetch }),
    }),
    { name: 'warnings-store' },
  ),
);

// ── Polling interval: 15 minutes ─────────────────────────
const POLL_MS = 15 * 60_000;

// ── Hook ─────────────────────────────────────────────────

export function useWarnings() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const { setWarnings, setLoading, setLastFetch } = useWarningsStore.getState();

  const poll = useCallback(async () => {
    setLoading(true);
    try {
      const all = await fetchMGWarnings();
      const sector = getWarningsForSector(all, sectorId as 'embalse' | 'rias');
      setWarnings(all, sector);
      setLastFetch(new Date());
    } catch (err) {
      console.warn('[useWarnings] Poll failed:', err);
    } finally {
      setLoading(false);
    }
  }, [sectorId, setWarnings, setLoading, setLastFetch]);

  useVisibilityPolling(poll, POLL_MS);
}
