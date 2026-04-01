/**
 * Aviation data polling hook.
 * Fetches OpenSky aircraft data with adaptive interval.
 * Only active when overlay enabled + Embalse sector.
 */
import { useCallback } from 'react';
import { useAviationStore } from '../store/aviationStore';
import { useSectorStore } from '../store/sectorStore';
import { fetchAircraft, getCreditsUsed } from '../api/aviationClient';
import { evaluateAviationAlert, computePollingInterval } from '../services/aviationAlertService';
import { useVisibilityPolling } from './useVisibilityPolling';

export function useAviationData() {
  const showOverlay = useAviationStore((s) => s.showOverlay);
  const pollIntervalMs = useAviationStore((s) => s.pollIntervalMs);
  const activeSector = useSectorStore((s) => s.activeSector);
  const enabled = showOverlay && activeSector.id === 'embalse';

  const fetchAndUpdate = useCallback(async () => {
    const store = useAviationStore.getState();
    store.setLoading(true);
    store.setError(null);

    try {
      const aircraft = await fetchAircraft();
      store.setAircraft(aircraft);
      store.setLastFetch(Date.now());
      store.setCreditsUsed(getCreditsUsed());

      // Evaluate alert
      const alert = evaluateAviationAlert(aircraft);
      store.setAlert(alert);

      // Adaptive polling — only change if delta > 2s to avoid rapid restarts
      const newInterval = computePollingInterval(aircraft);
      if (Math.abs(newInterval - store.pollIntervalMs) > 2000) {
        store.setPollInterval(newInterval);
      }
    } catch (err) {
      store.setError(err instanceof Error ? err.message : 'Error fetching aircraft');
    } finally {
      store.setLoading(false);
    }
  }, []);

  useVisibilityPolling(fetchAndUpdate, pollIntervalMs, enabled);
}
