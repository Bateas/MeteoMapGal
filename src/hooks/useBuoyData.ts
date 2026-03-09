/**
 * Hook to fetch and refresh marine buoy data from Puertos del Estado.
 * Mounted in AppShell so data loads regardless of sidebar visibility.
 * Only active when sector is 'rias'. Clears selection on sector switch.
 *
 * Uses useVisibilityPolling(enabled=isRias) — polling pauses on Embalse
 * and when the browser tab is hidden.
 *
 * Note: useVisibilityPolling fires the callback immediately on mount,
 * so no separate useEffect is needed for the initial fetch.
 */
import { useCallback } from 'react';
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

  // Single polling loop — enabled only on Rías sector.
  // useVisibilityPolling fires callback immediately on start → no double fetch.
  // When isRias becomes false, the hook cleans up the interval.
  useVisibilityPolling(fetchBuoys, REFRESH_INTERVAL, isRias);
}
