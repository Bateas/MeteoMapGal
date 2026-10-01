/**
 * Hook to fetch and refresh the marine buoys (Puertos del Estado and the Xunta).
 * Mounted in AppShell so data loads regardless of sidebar visibility.
 * Only active in coastal sectors. Clears selection on sector switch.
 *
 * Uses useVisibilityPolling(enabled=isCoastal) — polling pauses on inland
 * sectors and when the browser tab is hidden.
 *
 * Reads our own API. The fallback to the Xunta buoys (through our proxy) is
 * development-only; Puertos del Estado is never asked from the browser.
 *
 * Error recovery: on failure, retries after 5 min instead of waiting 30 min.
 */
import { useCallback, useEffect, useRef } from 'react';
import { fetchStoredBuoys } from '../api/buoyClient';
import { fetchAllObsReadings } from '../api/observatorioCosteiro';
import { useBuoyStore } from '../store/buoyStore';
import { useSectorStore } from '../store/sectorStore';
import { isCoastalSector } from '../config/sectors';
import { useVisibilityPolling } from './useVisibilityPolling';

const REFRESH_INTERVAL = 10 * 60_000; // 10 min (Observatorio Costeiro cadence)
const ERROR_RETRY_MS = 5 * 60_000;    // 5 min retry on error
/** Ask the providers straight from the browser only when running without our service. */
const DIRECT_FALLBACK = import.meta.env.DEV;

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
      // the providers.
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

      // Only in development. In production a failing API would otherwise send
      // every visitor to the provider at once. The map keeps the buoys it
      // already has and asks our API again on the retry below.
      if (!DIRECT_FALLBACK) {
        throw new Error('Sin datos de boyas de nuestro servicio');
      }

      // Puertos del Estado is never asked from the browser: our service reads it
      // through POEM, the access they set for third parties (1-oct-2026). Here,
      // only the Xunta buoys, through our own proxy.
      const obsData = await fetchAllObsReadings().catch((err) => {
        console.warn('[useBuoyData] ObsCosteiro fetch failed:', (err as Error).message);
        return [];
      });
      if (obsData.length === 0) {
        throw new Error('Sin datos de boyas (Observatorio Costeiro falló)');
      }
      setBuoys(obsData);
      setError(null);
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
