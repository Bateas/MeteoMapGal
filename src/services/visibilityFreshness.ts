/**
 * Freshness + proximity gating for AEMET regional visibility readings.
 *
 * `weatherStore.visibilityReadings` is replaced wholesale on each successful
 * AEMET poll and expires on nothing. Two consequences, both silent:
 *
 *  - AGE: when AEMET stops answering (its breaker opens for 30min, and 503
 *    chains on the `datos` endpoint are routine) the last Map simply stays.
 *    Consumers keep reading a frozen visibility, so a fog halo and a
 *    "Niebla confirmada (AEMET)" alert can sit over a clear sky indefinitely.
 *  - DISTANCE: the Map is deliberately sector-agnostic (fog detection needs
 *    region-wide coverage), so it mixes stations 200km apart. Real fog at the
 *    Fisterra lighthouse must not describe the sky over an inland sector.
 *
 * Stale or distant visibility is worse than none: it is presented as an
 * official government measurement, so it outranks the model in every
 * multi-evidence rule it feeds.
 */

import { haversineDistance } from './geoUtils';

/**
 * AEMET conventional observation publishes roughly hourly and the `datos`
 * endpoint adds its own lag on top. 2h tolerates one missed publication plus
 * that lag, while still expiring within a single breaker cooldown cycle:
 * long enough to ride out a hiccup, short enough that an outage stops
 * speaking for the sky.
 */
export const VISIBILITY_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * How far outside its own radius a sector will still accept a visibility
 * station. 1.5x keeps Ourense (~27km, legitimately relevant to Castrelo) and
 * drops Fisterra (~110km away).
 */
export const SECTOR_VISIBILITY_RADIUS_FACTOR = 1.5;

/**
 * Cadence for re-checking age in components. Freshness is time-dependent but
 * the store only pushes on a successful poll — during an outage nothing ever
 * re-renders the consumer, so it must re-evaluate on its own clock.
 */
export const VISIBILITY_STALE_CHECK_INTERVAL_MS = 60_000;

/** Minimal shape needed to judge age. `VisibilityReading` satisfies it. */
export interface AgedReading {
  timestamp?: Date | null;
}

/** Minimal shape needed to judge relevance. `VisibilityReading` satisfies it. */
export interface LocatedVisibility extends AgedReading {
  lat: number;
  lon: number;
  visibility: number;
}

/**
 * True when a reading is recent enough to describe the sky right now.
 *
 * Fails closed: a missing or unparseable timestamp means we cannot prove the
 * reading is current, and unprovable freshness is treated as stale.
 */
export function isVisibilityFresh(
  reading: AgedReading | null | undefined,
  now: number = Date.now(),
  maxAgeMs: number = VISIBILITY_MAX_AGE_MS,
): boolean {
  const ts = reading?.timestamp;
  if (!(ts instanceof Date)) return false;
  const t = ts.getTime();
  if (!Number.isFinite(t)) return false; // Invalid Date
  const age = now - t;
  // Mild clock skew between AEMET and the browser can put a legitimate
  // reading slightly in the future; anything further ahead is corrupt.
  return age <= maxAgeMs && age >= -maxAgeMs;
}

/**
 * Subset of the regional visibility map that may speak for a given sector:
 * recent enough AND close enough. Everything else is dropped, not downweighted
 * — a station that fails either gate is treated as if it had not reported.
 */
export function selectRelevantVisibility<T extends LocatedVisibility>(
  readings: ReadonlyMap<string, T>,
  centerLat: number,
  centerLon: number,
  maxDistanceKm: number,
  now: number = Date.now(),
): Map<string, T> {
  const out = new Map<string, T>();
  for (const [id, r] of readings) {
    if (!isVisibilityFresh(r, now)) continue;
    if (haversineDistance(centerLat, centerLon, r.lat, r.lon) > maxDistanceKm) continue;
    out.set(id, r);
  }
  return out;
}

/** Worst visibility among the given readings, or null when there are none. */
export function minVisibilityKm(
  readings: Iterable<{ visibility: number }>,
): number | null {
  let min: number | null = null;
  for (const r of readings) {
    if (typeof r.visibility !== 'number' || !Number.isFinite(r.visibility)) continue;
    if (min === null || r.visibility < min) min = r.visibility;
  }
  return min;
}

/**
 * Compact digest of a visibility set, for cache/signature comparison.
 *
 * Computed over the ALREADY GATED set so that a reading ageing out of the
 * freshness window changes the digest — otherwise a frozen Map would keep
 * producing the same signature and the alert could never be cleared.
 */
export function visibilitySignature(
  readings: ReadonlyMap<string, { visibility: number }>,
): string {
  return [...readings]
    .map(([id, v]) => `${id}:${v.visibility}`)
    .sort()
    .join(',');
}
