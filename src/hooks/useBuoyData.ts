/**
 * Hook to fetch and refresh marine buoy data from Puertos del Estado.
 * Mounted in AppShell so data loads regardless of sidebar visibility.
 * Only active when sector is 'rias'. Clears selection on sector switch.
 *
 * Uses useVisibilityPolling(enabled=isRias) — polling pauses on Embalse
 * and when the browser tab is hidden.
 *
 * Error recovery: on failure, retries after 5 min instead of waiting 30 min.
 * buoyClient.ts already retries 5xx errors 2x with exponential backoff before
 * reporting failure here.
 */
import { useCallback, useRef } from 'react';
import { fetchAllRiasBuoys, mergeBuoyReadings } from '../api/buoyClient';
import { fetchAllObsReadings } from '../api/observatorioCosteiro';
import { useBuoyStore } from '../store/buoyStore';
import { useSectorStore } from '../store/sectorStore';
import { useVisibilityPolling } from './useVisibilityPolling';

const REFRESH_INTERVAL = 10 * 60_000; // 10 min (Observatorio Costeiro cadence)
const ERROR_RETRY_MS = 5 * 60_000;    // 5 min retry on error

export function useBuoyData() {
  const activeSector = useSectorStore((s) => s.activeSector);
  const setBuoys = useBuoyStore((s) => s.setBuoys);
  const setLoading = useBuoyStore((s) => s.setLoading);
  const setError = useBuoyStore((s) => s.setError);
  const errorRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isRias = activeSector.id === 'rias';

  const fetchBuoys = useCallback(async () => {
    // Clear any pending error retry
    if (errorRetryRef.current) {
      clearTimeout(errorRetryRef.current);
      errorRetryRef.current = null;
    }
    setLoading(true);
    try {
      // Fetch PORTUS + Observatorio Costeiro in parallel — fail silently per source
      const [portusData, obsData] = await Promise.all([
        fetchAllRiasBuoys().catch((err) => {
          console.warn('[useBuoyData] PORTUS fetch failed:', (err as Error).message);
          return [];
        }),
        fetchAllObsReadings().catch((err) => {
          console.warn('[useBuoyData] ObsCosteiro fetch failed:', (err as Error).message);
          return [];
        }),
      ]);

      // Merge — prefer newest timestamp, preserve PORTUS-exclusive fields
      const merged = mergeBuoyReadings(portusData, obsData);

      if (merged.length === 0) {
        throw new Error('Sin datos de boyas (PORTUS + Observatorio Costeiro fallaron)');
      }

      setBuoys(merged);
      setError(null);

      if (obsData.length > 0) {
        console.log(`[useBuoyData] Merged: ${portusData.length} PORTUS + ${obsData.length} ObsCosteiro → ${merged.length} total`);
      }
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      console.warn('[useBuoyData] Fetch failed:', msg);
      // Schedule a faster retry on error (5 min instead of 30 min)
      errorRetryRef.current = setTimeout(() => {
        fetchBuoys();
      }, ERROR_RETRY_MS);
    }
  }, [setBuoys, setLoading, setError]);

  // Single polling loop — enabled only on Rías sector.
  // useVisibilityPolling fires callback immediately on start → no double fetch.
  // When isRias becomes false, the hook cleans up the interval.
  useVisibilityPolling(fetchBuoys, REFRESH_INTERVAL, isRias);
}
