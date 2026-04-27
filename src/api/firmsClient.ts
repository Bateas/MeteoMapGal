/**
 * NASA FIRMS active-fire client.
 *
 * Hits the ingestor proxy `/api/v1/firms?days=N` — the server injects the
 * MAP_KEY and pins the bounding box to Galicia + buffer. Frontend never sees
 * the key.
 *
 * VIIRS S-NPP NRT pipeline → ≤60min from satellite pass to availability.
 * Several passes per day over Galicia.
 */

import { parseFirmsCsv, filterRealFires } from '../services/fireService';
import type { ActiveFire } from '../types/fire';

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
    // Don't crash UI — return empty list. The pessimistic-init pattern from S118.
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
