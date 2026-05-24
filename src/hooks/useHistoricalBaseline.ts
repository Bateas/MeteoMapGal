/**
 * useHistoricalBaseline — per-station baseline fetch with browser cache.
 *
 * Used by SpotPopup's "Hoy vs media" badge. We fetch ONCE per station on
 * the first mount and reuse the result via a module-level Map (process-
 * lifetime cache — server already sets Cache-Control: max-age=3600).
 *
 * No polling: baselines are slow-moving (rolling 30d window). A single
 * static fetch per spot popup is plenty.
 */

import { useEffect, useState } from 'react';
import {
  fetchHistoricalBaseline,
  type HistoricalBaseline,
  type HistoricalBaselineResponse,
} from '../services/historicalBaselineService';

/** Module-level cache so repeated SpotPopup mounts don't re-fetch */
const cache = new Map<string, { data: HistoricalBaselineResponse; fetchedAt: number }>();
/** Process-lifetime TTL — pair this with server Cache-Control: 1h */
const CACHE_TTL_MS = 60 * 60 * 1000;

export function useHistoricalBaseline(
  stationId: string | null | undefined,
  metric: 'wind' | 'gust' | 'temp' | 'humidity' = 'wind',
  days: number = 30,
): { baseline: HistoricalBaseline | null; loading: boolean } {
  const [state, setState] = useState<{ baseline: HistoricalBaseline | null; loading: boolean }>(() => {
    if (!stationId) return { baseline: null, loading: false };
    const cacheKey = `${stationId}|${metric}|${days}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { baseline: cached.data.baseline, loading: false };
    }
    return { baseline: null, loading: true };
  });

  useEffect(() => {
    if (!stationId) {
      setState({ baseline: null, loading: false });
      return;
    }
    const cacheKey = `${stationId}|${metric}|${days}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setState({ baseline: cached.data.baseline, loading: false });
      return;
    }

    const ctrl = new AbortController();
    setState((prev) => ({ ...prev, loading: true }));
    fetchHistoricalBaseline(stationId, metric, days, ctrl.signal)
      .then((data) => {
        cache.set(cacheKey, { data, fetchedAt: Date.now() });
        setState({ baseline: data.baseline, loading: false });
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        // Soft-fail: the badge just doesn't render. Better than a noisy console.
        setState({ baseline: null, loading: false });
      });

    return () => ctrl.abort();
  }, [stationId, metric, days]);

  return state;
}
