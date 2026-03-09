/**
 * Hook to fetch and refresh marine buoy data from Puertos del Estado.
 * Mounted in AppShell so data loads regardless of sidebar visibility.
 * Only active when sector is 'rias'. Clears data on sector switch.
 *
 * Uses useVisibilityPolling to pause when tab is hidden.
 */
import { useCallback, useEffect, useRef } from 'react';
import { fetchAllRiasBuoys } from '../api/buoyClient';
import { useBuoyStore } from '../store/buoyStore';
import { useSectorStore } from '../store/sectorStore';
import { useVisibilityPolling } from './useVisibilityPolling';

const REFRESH_INTERVAL = 30 * 60_000; // 30 min (buoys update ~hourly)

export function useBuoyData() {
  const activeSector = useSectorStore((s) => s.activeSector);
  const setBuoys = useBuoyStore((s) => s.setBuoys);
  const setLoading = useBuoyStore((s) => s.setLoading);
  const setError = useBuoyStore((s) => s.setError);
  const selectBuoy = useBuoyStore((s) => s.selectBuoy);
  const lastFetch = useBuoyStore((s) => s.lastFetch);
  const fetchedRef = useRef(false);

  const isRias = activeSector.id === 'rias';

  const fetchBuoys = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAllRiasBuoys();
      setBuoys(data);
    } catch (err) {
      setError((err as Error).message);
      console.warn('[useBuoyData] Fetch failed:', (err as Error).message);
    }
  }, [setBuoys, setLoading, setError]);

  // Initial fetch when switching to Rías sector
  useEffect(() => {
    if (!isRias) {
      // Clear buoy selection when leaving Rías
      selectBuoy(null);
      fetchedRef.current = false;
      return;
    }

    // Fetch if never fetched or data is stale
    const age = Date.now() - lastFetch;
    if (!fetchedRef.current || age > REFRESH_INTERVAL) {
      fetchedRef.current = true;
      fetchBuoys();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRias]);

  // Periodic refresh using visibility-aware polling
  useVisibilityPolling(fetchBuoys, REFRESH_INTERVAL, isRias);
}
