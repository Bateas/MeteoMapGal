/**
 * Aviation data polling hook.
 * Fetches OpenSky aircraft data with adaptive interval.
 * Active when: overlay toggled on, OR event mode active (any sector).
 */
import { useCallback } from 'react';
import { useAviationStore } from '../store/aviationStore';
import { useRegattaStore } from '../store/regattaStore';
import { fetchAircraft, getCreditsUsed } from '../api/aviationClient';
import { evaluateAviationAlert, computePollingInterval } from '../services/aviationAlertService';
import { useVisibilityPolling } from './useVisibilityPolling';

export function useAviationData() {
  const showOverlay = useAviationStore((s) => s.showOverlay);
  const pollIntervalMs = useAviationStore((s) => s.pollIntervalMs);
  const regattaActive = useRegattaStore((s) => s.active && s.zone !== null);
  // Active when overlay is on OR event mode is active (aviation = safety for events)
  const enabled = showOverlay || regattaActive;

  const fetchAndUpdate = useCallback(async () => {
    const store = useAviationStore.getState();
    store.setLoading(true);
    store.setError(null);

    try {
      const aircraft = await fetchAircraft();
      store.setAircraft(aircraft);
      store.updateTrajectories(aircraft);
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
