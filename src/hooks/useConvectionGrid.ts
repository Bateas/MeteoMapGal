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
 *
 * S126+1+1 v2.70.1: added in-flight dedup. The first version fired on
 * (a) component mount + (b) toggle-on useEffect + (c) the visibility-poller's
 * stagger tick, all close in time. With React Strict Mode in dev that can
 * triple the calls and trigger Open-Meteo's short-term 429 rate limit. A
 * single AbortController + an isFetching guard prevent duplicate requests.
 */
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { fetchConvectionGrid, type ConvectionGridSnapshot } from '../services/convectionGridService';
import { useVisibilityPolling } from './useVisibilityPolling';
import { useMapStyleStore } from '../store/mapStyleStore';

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const MIN_FETCH_GAP_MS = 60 * 1000; // dedup window — don't fetch twice in 60s

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

  // In-flight guard + last-fetch timestamp — prevents the bursty
  // mount + toggle + poll-stagger combo from firing 3 fetches at once.
  const inFlightRef = useRef<AbortController | null>(null);
  const lastFetchAtRef = useRef<number>(0);

  const poll = async () => {
    if (!showRisk) return;
    const now = Date.now();
    // Dedup: skip if there's an in-flight request OR if we just finished one
    if (inFlightRef.current) return;
    if (now - lastFetchAtRef.current < MIN_FETCH_GAP_MS) return;

    const ctrl = new AbortController();
    inFlightRef.current = ctrl;
    setLoading(true);
    try {
      const snap = await fetchConvectionGrid({ signal: ctrl.signal });
      setSnapshot(snap);
      setError(null);
      lastFetchAtRef.current = Date.now();
    } catch (err) {
      // Aborts are intentional — don't surface as errors
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message);
    } finally {
      setLoading(false);
      if (inFlightRef.current === ctrl) inFlightRef.current = null;
    }
  };

  useVisibilityPolling(poll, POLL_INTERVAL_MS, true, 2000);

  // Re-fetch immediately when toggled ON (dedup guard prevents flooding)
  useEffect(() => {
    if (showRisk) poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRisk]);

  // Abort in-flight request when component unmounts
  useEffect(() => {
    return () => {
      if (inFlightRef.current) {
        inFlightRef.current.abort();
        inFlightRef.current = null;
      }
    };
  }, []);
}
