/**
 * NASA FIRMS active-fire client.
 *
 * Hits the ingestor proxy `/api/v1/firms?days=N` — the server injects the
 * MAP_KEY and pins the bounding box to Galicia + buffer. Frontend never sees
 * the key.
 *
 * VIIRS NRT pipelines (S-NPP + NOAA-20) → ≤60min from satellite pass to
 * availability, roughly four passes a day over Galicia between the two.
 */

import { parseFirmsCsv, filterRealFires } from '../services/fireService';
import type { ActiveFire, FireWithAttribution } from '../types/fire';

// Same proxy base used by ObsCosteiro / forecast / marine — nginx prod or Vite proxy in dev
const PROXY_BASE = '/api/v1';

export interface FirmsFetchResult {
  fires: ActiveFire[];
  fetchedAt: number;
  fromCache: 'hit' | 'miss' | 'stale' | 'unknown';
}

/**
 * Fetch active fires for Galicia + buffer.
 * Returns filtered list (low-confidence + cool industrial signatures dropped).
 *
 * `days` is 1-5 — defaults to 1 (last 24h, real-time use case).
 */
export async function fetchActiveFires(days = 1): Promise<FirmsFetchResult> {
  const url = `${PROXY_BASE}/firms?days=${Math.max(1, Math.min(5, days))}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });

  if (!res.ok) {
    // Don't crash UI — return empty list (pessimistic-init pattern).
    return { fires: [], fetchedAt: Date.now(), fromCache: 'unknown' };
  }

  const csv = await res.text();
  const all = parseFirmsCsv(csv);
  const fires = filterRealFires(all);

  const cacheHeader = res.headers.get('x-cache')?.toLowerCase() ?? 'unknown';
  const fromCache: FirmsFetchResult['fromCache'] =
    cacheHeader === 'hit' ? 'hit' : cacheHeader === 'stale' ? 'stale' : cacheHeader === 'miss' ? 'miss' : 'unknown';

  return { fires, fetchedAt: Date.now(), fromCache };
}

/**
 * Fire → lightning attribution from our own data (`/api/v1/fires`).
 *
 * Separate from `fetchActiveFires` on purpose: the map keeps drawing fires
 * straight from the live FIRMS proxy even if our database is unreachable, and
 * this only adds the "a strike probably lit this" story on top. Keyed by
 * rounded lat/lon so the overlay can look a hotspot up — both sources are the
 * same FIRMS rows, so the coordinates match exactly.
 */
export async function fetchFireAttribution(days = 3): Promise<Map<string, FireWithAttribution>> {
  const out = new Map<string, FireWithAttribution>();
  try {
    const res = await fetch(`${PROXY_BASE}/fires?days=${Math.max(1, Math.min(30, days))}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return out;
    const body = (await res.json()) as { fires?: FireWithAttribution[] };
    for (const f of body.fires ?? []) {
      if (f.strikeCount > 0) out.set(fireAttributionKey(f.lat, f.lon), f);
    }
  } catch {
    // Attribution is a nice-to-have — the fires themselves come from the proxy.
  }
  return out;
}

/** Lookup key shared by the client and the overlay. */
export function fireAttributionKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)}_${lon.toFixed(4)}`;
}
