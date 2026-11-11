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
import { fetchIpmaWarnings, getIpmaWarningsForSector, type IpmaWarning } from '../api/ipmaWarningsClient';
import { useSectorStore } from '../store/sectorStore';
import { useVisibilityPolling } from './useVisibilityPolling';
import { useCallback, useEffect } from 'react';

// ── Store ────────────────────────────────────────────────

interface WarningsState {
  /** All warnings from MG RSS */
  allWarnings: MGWarning[];
  /** Warnings filtered for current sector */
  sectorWarnings: MGWarning[];
  /** IPMA transboundary warnings for current sector */
  ipmaSectorWarnings: IpmaWarning[];
  /** All IPMA warnings as downloaded, so a change of sector can pick its own without waiting for the next poll */
  allIpmaWarnings: IpmaWarning[];
  /** The sector the two sector lists were picked for. A surface never has to trust a list of another sector. */
  sectorId: string | null;
  /** Last successful fetch time */
  lastFetch: Date | null;
  /** Loading state */
  isLoading: boolean;

  setWarnings: (all: MGWarning[], sector: MGWarning[], ipmaSector?: IpmaWarning[]) => void;
  /** Store what was downloaded and pick the lists of `sectorId` from it. */
  setDownloaded: (all: MGWarning[], allIpma: IpmaWarning[], sectorId: string) => void;
  /** Pick the lists of another sector from what is already downloaded (no request). */
  pickSector: (sectorId: string) => void;
  setLoading: (v: boolean) => void;
  setLastFetch: (d: Date) => void;
}

/** The warnings of one sector, out of everything downloaded. The one place that decides it. */
function pickFor(all: MGWarning[], allIpma: IpmaWarning[], sectorId: string) {
  return {
    sectorWarnings: getWarningsForSector(all, sectorId as 'embalse' | 'rias'),
    ipmaSectorWarnings: getIpmaWarningsForSector(allIpma, sectorId),
  };
}

export const useWarningsStore = create<WarningsState>()(
  devtools(
    (set) => ({
      allWarnings: [],
      sectorWarnings: [],
      ipmaSectorWarnings: [],
      allIpmaWarnings: [],
      sectorId: null,
      lastFetch: null,
      isLoading: false,

      setWarnings: (allWarnings, sectorWarnings, ipmaSectorWarnings = []) =>
        set({ allWarnings, sectorWarnings, ipmaSectorWarnings }),
      setDownloaded: (allWarnings, allIpmaWarnings, sectorId) =>
        set({ allWarnings, allIpmaWarnings, sectorId, ...pickFor(allWarnings, allIpmaWarnings, sectorId) }),
      pickSector: (sectorId) =>
        set((st) => (st.sectorId === sectorId ? st : { sectorId, ...pickFor(st.allWarnings, st.allIpmaWarnings, sectorId) })),
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
  const { setDownloaded, pickSector, setLoading, setLastFetch } = useWarningsStore.getState();

  // The strip showed the warnings of the sector just left («Pontevedra» over Ourense) until the next
  // poll, up to 15 min: the lists were picked once, when the download landed, and a change of sector
  // did not pick them again. The download is the same for every sector, so the change picks its own
  // list from it at once. A store subscription and not an effect: it runs inside the change of sector,
  // before anything draws, so no frame shows the list of the other sector.
  useEffect(() => {
    pickSector(useSectorStore.getState().activeSector.id);
    return useSectorStore.subscribe((st, prev) => {
      if (st.activeSector.id !== prev.activeSector.id) pickSector(st.activeSector.id);
    });
  }, [pickSector]);

  const poll = useCallback(async () => {
    setLoading(true);
    try {
      const [mgResult, ipmaResult] = await Promise.allSettled([
        fetchMGWarnings(),
        fetchIpmaWarnings(),
      ]);

      const all = mgResult.status === 'fulfilled' ? mgResult.value : [];
      const allIpma = ipmaResult.status === 'fulfilled' ? ipmaResult.value : [];

      // The sector on screen NOW, not the one that asked: the answer can land after a change of sector.
      setDownloaded(all, allIpma, useSectorStore.getState().activeSector.id);
      setLastFetch(new Date());
    } catch (err) {
      console.warn('[useWarnings] Poll failed:', err);
    } finally {
      setLoading(false);
    }
  }, [setDownloaded, setLoading, setLastFetch]);

  useVisibilityPolling(poll, POLL_MS);
}
