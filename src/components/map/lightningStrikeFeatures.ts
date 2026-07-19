/**
 * Pure helpers for the LightningOverlay two-source split.
 *
 * Extracted from LightningOverlay.tsx so the live/historical partition and the
 * age-bucket styling key are unit-testable — the overlay itself is a lazy
 * MapLibre component no test imports, so this is the only layer where a silent
 * regression in "which strikes go where" can be caught before runtime.
 */
import type { LightningStrike } from '../../types/lightning';

/** Live source = strikes below this age (min). Overlaps the historical band by
 *  10 min on purpose so a strike crossing 60 min stays rendered by the
 *  always-fresh live source until the throttled historical rebuild picks it up
 *  (otherwise it would vanish from BOTH sources between rebuilds). */
export const LIVE_MAX_AGE_MIN = 70;
/** Historical source = strikes at/above this age (min). */
export const HIST_MIN_AGE_MIN = 60;

/**
 * Throttle guard for the historical-source rebuild.
 *
 * The 10-min throttle exists to avoid re-serializing thousands of features to
 * the MapLibre worker on every poll — but it must NOT apply to the mount race:
 * the overlay builds once with the store still EMPTY (arming the throttle),
 * the first fetch lands seconds later, and day-old strikes would then wait a
 * full throttle window to appear after every page load.
 *
 * Rule: the empty→data transition renders immediately; everything else obeys
 * the throttle.
 */
export function shouldRebuildHistorical(
  nowMs: number,
  lastBuildMs: number,
  lastBuiltCount: number,
  nextCount: number,
  throttleMs: number,
): boolean {
  if (lastBuiltCount <= 0 && nextCount > 0) return true;
  return nowMs - lastBuildMs >= throttleMs;
}

/** Age bucket drives the circle paint: 0=fresh (<15m, bright/large),
 *  1=recent (15-60m), 2=old (1-6h), 3=ancient (6-24h, faint/tiny). */
export type AgeBucket = 0 | 1 | 2 | 3;

export function ageBucket(ageMinutes: number): AgeBucket {
  if (ageMinutes < 15) return 0;
  if (ageMinutes < 60) return 1;
  if (ageMinutes < 360) return 2;
  return 3;
}

/** Belongs in the live (every-poll) source. */
export const isLiveStrike = (s: LightningStrike): boolean => s.ageMinutes < LIVE_MAX_AGE_MIN;

/** Belongs in the historical (throttled) source. The 60-70 min overlap means a
 *  strike in that band is in BOTH — intentional, see LIVE_MAX_AGE_MIN. */
export const isHistoricalStrike = (s: LightningStrike): boolean => s.ageMinutes >= HIST_MIN_AGE_MIN;

/** Build the GeoJSON the overlay feeds to a <Source>. Each strike carries the
 *  props the circle layers read (ageBucket for styling, cloudToCloud for opacity). */
export function buildStrikeFeatures(strikes: LightningStrike[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: strikes.map((strike) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [strike.lon, strike.lat],
      },
      properties: {
        id: strike.id,
        ageMinutes: strike.ageMinutes,
        peakCurrent: Math.abs(strike.peakCurrent),
        cloudToCloud: strike.cloudToCloud ? 1 : 0,
        multiplicity: strike.multiplicity,
        ageBucket: ageBucket(strike.ageMinutes),
      },
    })),
  };
}
