/**
 * NASA FIRMS active-fire client.
 *
 * Reads the hotspots our server already stores (`/api/v1/fires`): the ingestor asks NASA for
 * the whole Galician bbox every hour and keeps every detection with the display filter's
 * verdict, so the map no longer asks NASA through our proxy as well (21-oct audit, finding 13).
 * The proxy `/api/v1/firms?days=N` (server-side MAP_KEY, bbox pinned) stays as the fallback
 * for when our database cannot answer.
 *
 * VIIRS NRT pipelines (S-NPP + NOAA-20) → ≤60min from satellite pass to
 * availability, roughly four passes a day over Galicia between the two.
 */

import { parseFirmsCsv, filterRealFires } from '../services/fireService';
import type { ActiveFire, FireConfidence, FireWithAttribution } from '../types/fire';

// Same proxy base used by ObsCosteiro / forecast / marine — nginx prod or Vite proxy in dev
const PROXY_BASE = '/api/v1';

export interface FirmsFetchResult {
  fires: ActiveFire[];
  fetchedAt: number;
  /** 'stored' = from our database; the rest describe the live FIRMS proxy. */
  fromCache: 'stored' | 'hit' | 'miss' | 'stale' | 'unknown';
}

/** A timestamptz as Postgres prints it ("2026-06-25 02:18:00+00"), or ISO; ms or NaN. */
export function parsePgTimestamp(s: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$/.exec(s.trim());
  if (m) return Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4] ?? '00'}`);
  return Date.parse(s);
}

const CONFIDENCES: ReadonlySet<string> = new Set<FireConfidence>(['low', 'nominal', 'high']);

/**
 * A stored hotspot as the map's ActiveFire. The server only returns rows that passed the
 * display filter when they were stored (`passes_display_filter`, the same `filterRealFires`),
 * so it is not run again; the brightness is not served and stays 0, which is what the CSV
 * parser also writes when FIRMS leaves it out. Null for a row without a usable time or place.
 */
export function storedFireToActive(f: FireWithAttribution): ActiveFire | null {
  const t = typeof f.time === 'string' ? parsePgTimestamp(f.time) : NaN;
  if (!Number.isFinite(t) || !Number.isFinite(f.lat) || !Number.isFinite(f.lon)) return null;
  const acquiredAt = new Date(t);
  const iso = acquiredAt.toISOString();
  return {
    id: `${f.lat.toFixed(5)}_${f.lon.toFixed(5)}_${iso.slice(0, 10)}_${iso.slice(11, 13)}${iso.slice(14, 16)}`,
    lat: f.lat,
    lon: f.lon,
    brightness: 0,
    frp: f.frp ?? 0,
    acquiredAt,
    satellite: f.satellite,
    confidence: (f.confidence && CONFIDENCES.has(f.confidence) ? f.confidence : 'nominal') as FireConfidence,
    daynight: f.daynight === 'N' ? 'N' : 'D',
  };
}

/**
 * Fetch active fires for Galicia + buffer.
 *
 * Returns individual HOTSPOT DETECTIONS, filtered for reliability (see
 * `filterRealFires`). These are satellite pixels, not fires: one wildfire
 * produces many rows across satellites, passes and adjacent pixels. Any
 * surface that shows or counts fires must go through `selectFireClusters`
 * (services/fireClustering) rather than reading this list directly.
 *
 * `days` is 1-5 — defaults to 1 (last 24h, real-time use case).
 */
export async function fetchActiveFires(days = 1): Promise<FirmsFetchResult> {
  const d = Math.max(1, Math.min(5, days));
  try {
    const res = await fetch(`${PROXY_BASE}/fires?days=${d}`, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const body = (await res.json()) as { fires?: FireWithAttribution[] };
      if (Array.isArray(body?.fires)) {
        const fires = body.fires.map(storedFireToActive).filter((f): f is ActiveFire => f !== null);
        return { fires, fetchedAt: Date.now(), fromCache: 'stored' };
      }
    }
  } catch (err) {
    console.debug('[FIRMS] stored fires unavailable, asking the live proxy:', err);
  }
  return fetchActiveFiresLive(d);
}

/** The live FIRMS proxy: only when our database cannot answer. */
async function fetchActiveFiresLive(days: number): Promise<FirmsFetchResult> {
  const url = `${PROXY_BASE}/firms?days=${days}`;
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
 * (from the live FIRMS proxy when our database is unreachable), and
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
  } catch (err) {
    // Attribution is a nice-to-have — the fires themselves come from the proxy.
    // But a permanently broken endpoint drops the purple lightning ring with
    // no other symptom (fires keep rendering), so say it out loud.
    console.debug('[FIRMS] attribution unavailable:', err);
  }
  return out;
}

/** Lookup key shared by the client and the overlay. */
export function fireAttributionKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)}_${lon.toFixed(4)}`;
}
