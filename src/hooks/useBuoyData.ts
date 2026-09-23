/**
 * Hook to fetch and refresh marine buoy data from Puertos del Estado.
 * Mounted in AppShell so data loads regardless of sidebar visibility.
 * Only active in coastal sectors. Clears selection on sector switch.
 *
 * Uses useVisibilityPolling(enabled=isCoastal) — polling pauses on inland
 * sectors and when the browser tab is hidden.
 *
 * Error recovery: on failure, retries after 5 min instead of waiting 30 min.
 * buoyClient.ts already retries 5xx errors 2x with exponential backoff before
 * reporting failure here.
 */
import { useCallback, useEffect, useRef } from 'react';
import { fetchAllRiasBuoys, fetchStoredBuoys, mergeBuoyReadings } from '../api/buoyClient';
import { fetchAllObsReadings } from '../api/observatorioCosteiro';
import { useBuoyStore } from '../store/buoyStore';
import { useSectorStore } from '../store/sectorStore';
import { isCoastalSector } from '../config/sectors';
import { useVisibilityPolling } from './useVisibilityPolling';

const REFRESH_INTERVAL = 10 * 60_000; // 10 min (Observatorio Costeiro cadence)
const ERROR_RETRY_MS = 5 * 60_000;    // 5 min retry on error

export function useBuoyData() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const setBuoys = useBuoyStore((s) => s.setBuoys);
  const setLoading = useBuoyStore((s) => s.setLoading);
  const setError = useBuoyStore((s) => s.setError);
  const errorRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isCoastal = isCoastalSector(sectorId);
  /** Read inside the callback, which must not be rebuilt on a sector change. */
  const isCoastalRef = useRef(isCoastal);

  const fetchBuoys = useCallback(async () => {
    // Clear any pending error retry
    if (errorRetryRef.current) {
      clearTimeout(errorRetryRef.current);
      errorRetryRef.current = null;
    }
    setLoading(true);
    try {
      // Our own service already polls both providers, merges them and stores
      // the result: one request, and nothing from the visitor's browser to
      // Puertos del Estado, who rate-limit by address and already warned us
      // once. The direct path below stays as the fallback (and for running
      // the app without our service, in development).
      try {
        const stored = await fetchStoredBuoys();
        if (stored.length > 0) {
          setBuoys(stored);
          setError(null);
          console.debug(`[useBuoyData] ${stored.length} buoys from our own API`);
          return;
        }
        console.warn('[useBuoyData] own API returned no buoys, asking the providers');
      } catch (apiErr) {
        console.warn('[useBuoyData] own API failed, asking the providers:', (apiErr as Error).message);
      }

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
        console.debug(`[useBuoyData] Merged: ${portusData.length} PORTUS + ${obsData.length} ObsCosteiro → ${merged.length} total`);
      }
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      console.warn('[useBuoyData] Fetch failed:', msg);
      // Schedule a faster retry on error (5 min instead of 30 min), but only
      // where it makes sense. This timer used to be scheduled unconditionally
      // and cancelled by nobody: it survived the tab being hidden, the switch
      // to an inland sector and the component going away, so a provider that
      // was failing kept being asked for eleven stations every five minutes
      // by a page nobody was looking at.
      if (isCoastalRef.current && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
        errorRetryRef.current = setTimeout(() => {
          fetchBuoys();
        }, ERROR_RETRY_MS);
      }
    }
  }, [setBuoys, setLoading, setError]);

  // Clear buoy data when leaving Rías — prevents stale maritime alerts in Embalse
  useEffect(() => {
    isCoastalRef.current = isCoastal;
    if (!isCoastal) {
      if (errorRetryRef.current) {
        clearTimeout(errorRetryRef.current);
        errorRetryRef.current = null;
      }
      setBuoys([]);
    }
  }, [isCoastal, setBuoys]);

  // Leaving the page must take the pending retry with it.
  useEffect(() => () => {
    if (errorRetryRef.current) {
      clearTimeout(errorRetryRef.current);
      errorRetryRef.current = null;
    }
  }, []);

  // Single polling loop — enabled only on Rías sector.
  // useVisibilityPolling fires callback immediately on start → no double fetch.
  // When isCoastal becomes false, the hook cleans up the interval.
  useVisibilityPolling(fetchBuoys, REFRESH_INTERVAL, isCoastal, 3_000); // Stagger: 3s after page load
}
