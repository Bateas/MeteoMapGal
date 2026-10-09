import type { LightningStrike } from '../types/lightning';

/**
 * Lightning strikes for the map, read from OUR API only.
 *
 * The ingestor is the one asking MeteoGalicia and it stores every strike; the browser never
 * asks MeteoGalicia. MeteoGalicia told us (2-oct and 9-oct) that meteo2api and its map
 * services are not meant for third-party apps, and asked for no more than one request every
 * 5 minutes: one server asking is the way to keep to that, so there is no direct fallback
 * from the browser any more. `src/api/noMeteo2api.test.ts` keeps it that way.
 *
 * Source: MeteoGalicia / Xunta de Galicia (CC BY-SA 4.0)
 */

// ── Cache ────────────────────────────────────────────────────────

let cache: { data: LightningStrike[]; fetchedAt: number } | null = null;
/** Cache TTL for quiet conditions (no recent nearby strikes). */
const CACHE_TTL_NORMAL_MS = 2 * 60 * 1000;
/** Cache TTL when a storm is active (recent strikes < 15 min ago, < 80 km): our API, not the
 *  provider, so a short TTL costs MeteoGalicia nothing. */
const CACHE_TTL_STORM_MS = 30 * 1000;
/** After our API fails, wait this long before asking it again (the hook's quick retries land inside
 *  it and stay off the network). One minute: with polls every 2 min (1 in a storm) the map is back
 *  on the next poll once our API answers; at 3 min it could stay on the stale picture for 4. */
const API_COOLDOWN_MS = 60_000;

// ── Our own API (6-oct) ──────────────────────────────────────────
// The ingestor is the only one asking MeteoGalicia (every 5 min, what MeteoGalicia asks for) and
// stores every strike. The map used to pull the whole day from meteo2api every minute in a
// storm: 1 MB per tab, and a provider call per half minute while anyone watched. Now it takes
// the day once and then only the last half hour, merged here.

const RECENT_URL = '/api/v1/lightning/recent';
/** The windows the API serves, in minutes. */
const API_WINDOWS_MIN = [30, 120, 1440] as const;
const DAY_MS = 24 * 60 * 60_000;
/** [time ms, lat, lon, peak kA (signed), cloud-to-cloud 0/1] — see ingestor queryRecentLightning. */
export type RecentStrikeRow = [number, number, number, number, number];

const known = new Map<string, LightningStrike>();
const nextId = { value: 1 };
let lastApiAt: number | null = null;
let apiDownUntil = 0;

/** The smallest window that reaches back past the last good read (the whole day on the first). */
export function apiWindowMinutes(nowMs: number, lastReadAt: number | null): number {
  if (lastReadAt == null) return 1440;
  const need = Math.ceil((nowMs - lastReadAt) / 60_000) + 10;
  return API_WINDOWS_MIN.find((m) => m >= need) ?? 1440;
}

/**
 * Add the rows not seen yet (a strike keeps its id for as long as it stays), drop those over a
 * day old, and return the day newest first with ages for `nowMs`. Pure apart from the map and
 * the id counter it is handed.
 */
export function mergeStrikes(
  seen: Map<string, LightningStrike>,
  rows: RecentStrikeRow[],
  nowMs: number,
  ids: { value: number },
): LightningStrike[] {
  for (const [t, lat, lon, ka, cc] of rows) {
    const key = `${t}|${lat}|${lon}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      id: ids.value++, lat, lon, timestamp: t, peakCurrent: ka,
      cloudToCloud: cc === 1, multiplicity: 1, ageMinutes: 0,
    });
  }
  for (const [key, s] of seen) if (nowMs - s.timestamp > DAY_MS) seen.delete(key);
  return [...seen.values()]
    .map((s) => ({ ...s, ageMinutes: Math.round((nowMs - s.timestamp) / 60_000) }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

/** The day of strikes from our API, or null when it fails. */
async function fetchFromOwnApi(): Promise<LightningStrike[] | null> {
  if (Date.now() < apiDownUntil) return null;
  const askedAt = Date.now();
  try {
    const res = await fetch(`${RECENT_URL}?minutes=${apiWindowMinutes(askedAt, lastApiAt)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Lightning API ${res.status}`);
    const body = await res.json() as { strikes?: unknown };
    if (!Array.isArray(body.strikes)) throw new Error('Lightning API: no strikes array');
    const strikes = mergeStrikes(known, body.strikes as RecentStrikeRow[], Date.now(), nextId);
    lastApiAt = askedAt;
    return strikes;
  } catch (err) {
    apiDownUntil = Date.now() + API_COOLDOWN_MS;
    console.debug('[Lightning] own API failed, keeping the last picture:', err);
    return null;
  }
}

export interface LightningFetch {
  /** The last 24 hours, newest first. */
  strikes: LightningStrike[];
  /** When these strikes came from our API (epoch ms); null when it never answered. */
  asOf: number | null;
  /** False when our API failed just now: `strikes` is the last day we had (ages updated), or none.
   *  The caller must not take that for a fresh answer: «no strikes» would read as «no storm». */
  fresh: boolean;
}

/**
 * Lightning strikes from the last 24 hours, from our API (the ingestor's table), with when they
 * were read and whether this answer is fresh.
 *
 * `opts.stormActive` shortens the cache TTL from 2 min to 30 s — used during
 * active storms (recent nearby strikes) so the user sees fresh strikes ASAP.
 */
export async function fetchLightningStrikes(
  opts: { stormActive?: boolean } = {},
): Promise<LightningFetch> {
  const ttl = opts.stormActive ? CACHE_TTL_STORM_MS : CACHE_TTL_NORMAL_MS;
  // Return cached data if fresh enough
  if (cache && Date.now() - cache.fetchedAt < ttl) {
    return { strikes: recomputeAges(cache.data), asOf: cache.fetchedAt, fresh: true };
  }

  const own = await fetchFromOwnApi();
  if (own) {
    cache = { data: own, fetchedAt: Date.now() };
    return { strikes: own, asOf: cache.fetchedAt, fresh: true };
  }
  return { strikes: cache ? recomputeAges(cache.data) : [], asOf: cache?.fetchedAt ?? null, fresh: false };
}

/** Recompute ageMinutes from cached timestamps */
function recomputeAges(strikes: LightningStrike[]): LightningStrike[] {
  const now = Date.now();
  return strikes.map((s) => ({
    ...s,
    ageMinutes: Math.round((now - s.timestamp) / 60_000),
  }));
}

/**
 * Haversine distance in km between two points.
 */
export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
