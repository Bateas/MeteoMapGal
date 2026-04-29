/**
 * useConvectionGrid — periodic fetch of the spatial CAPE/LI grid.
 *
 * Lives in a tiny dedicated store so the overlay subscribes directly without
 * coupling to forecastStore (which is already crowded). 30-min cache: CAPE
 * doesn't shift faster than that on synoptic scales.
 *
 * Polling pauses when the tab is hidden (useVisibilityPolling), and only
 * fires while the convection-risk overlay is toggled ON — avoids burning
 * Open-Meteo quota when the user isn't looking.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { fetchConvectionGrid, type ConvectionGridSnapshot } from '../services/convectionGridService';
import { useVisibilityPolling } from './useVisibilityPolling';
import { useMapStyleStore } from '../store/mapStyleStore';

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 min

interface ConvectionGridState {
  snapshot: ConvectionGridSnapshot | null;
  isLoading: boolean;
  error: string | null;
  setSnapshot: (s: ConvectionGridSnapshot) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useConvectionGridStore = create<ConvectionGridState>((set) => ({
  snapshot: null,
  isLoading: false,
  error: null,
  setSnapshot: (snapshot) => set({ snapshot }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));

export function useConvectionGrid(): void {
  const showRisk = useMapStyleStore((s) => s.showConvectionRisk);
  const setSnapshot = useConvectionGridStore((s) => s.setSnapshot);
  const setLoading = useConvectionGridStore((s) => s.setLoading);
  const setError = useConvectionGridStore((s) => s.setError);

  // Visibility-aware polling — only when overlay is ON
  const poll = async () => {
    if (!showRisk) return;
    setLoading(true);
    try {
      const snap = await fetchConvectionGrid();
      setSnapshot(snap);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useVisibilityPolling(poll, POLL_INTERVAL_MS, true, 2000);

  // Re-fetch immediately when toggled ON (don't wait for next poll tick)
  useEffect(() => {
    if (showRisk) poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRisk]);
}
