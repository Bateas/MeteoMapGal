/**
 * The last two hours of every spot's figure, once per visit: without it nothing can say «sube» or «baja» until the
 * visitor has had the page open for an hour. One small request, cached at the edge; if it fails the trend just
 * takes that hour to appear.
 */
import { useEffect } from 'react';
import { useSpotStore, type SpotWindSnapshot } from '../store/spotStore';

interface StoredScore {
  time: string;
  spot_id: string;
  wind_kt: number | null;
}

/** Pure, for the test: rows of the API to points per spot. A row with no figure is left out, never read as calm. */
export function pointsBySpot(rows: readonly StoredScore[]): Map<string, SpotWindSnapshot[]> {
  const out = new Map<string, SpotWindSnapshot[]>();
  for (const r of rows) {
    const ts = new Date(r.time).getTime();
    if (r.wind_kt == null || !Number.isFinite(ts)) continue;
    const list = out.get(r.spot_id);
    if (list) list.push({ ts, kt: r.wind_kt });
    else out.set(r.spot_id, [{ ts, kt: r.wind_kt }]);
  }
  return out;
}

export function useSpotTrendSeed() {
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/spots/scores?days=1&hours=2', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { scores?: StoredScore[] } | null) => {
        if (d?.scores) useSpotStore.getState().seedWindHistory(pointsBySpot(d.scores));
      })
      .catch(() => { /* the trend appears on its own within the hour */ });
    return () => controller.abort();
  }, []);
}
