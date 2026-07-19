/**
 * Tests for visibilityFreshness — the age + distance gates on AEMET regional
 * visibility.
 *
 * Both gates guard the same failure mode: a reading that is presented to the
 * user as an official measurement while it no longer describes the sky over
 * the sector being viewed — because it is hours old (AEMET outage froze the
 * store) or because it was taken 110km away.
 *
 * `now` is always passed explicitly so the suite never depends on the wall
 * clock or the runner's timezone.
 */

import { describe, it, expect } from 'vitest';
import type { VisibilityReading } from '../store/weatherStore';
import {
  isVisibilityFresh,
  selectRelevantVisibility,
  minVisibilityKm,
  visibilitySignature,
  VISIBILITY_MAX_AGE_MS,
  SECTOR_VISIBILITY_RADIUS_FACTOR,
} from './visibilityFreshness';

const NOW = new Date('2026-07-20T12:00:00Z').getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Real geography — these are the coordinates that produced the reported bug.
const EMBALSE_CENTER = { lat: 42.29, lon: -8.1 }; // Embalse de Castrelo
const EMBALSE_RADIUS_KM = 35;
const EMBALSE_GATE_KM = EMBALSE_RADIUS_KM * SECTOR_VISIBILITY_RADIUS_FACTOR;

/** AEMET 1690A — Ourense ciudad, ~20km from Castrelo. Legitimately relevant. */
const OURENSE = { lat: 42.33, lon: -7.86 };
/** AEMET 1400 — Cabo Fisterra lighthouse, ~115km away. Another world entirely. */
const FISTERRA = { lat: 42.9053, lon: -9.2725 };
/** AEMET 1351 — Estaca de Bares, north coast, ~170km away. */
const ESTACA_DE_BARES = { lat: 43.79, lon: -7.68 };

function makeReading(
  over: Partial<VisibilityReading> & { stationId: string },
): VisibilityReading {
  return {
    name: over.stationId,
    lat: OURENSE.lat,
    lon: OURENSE.lon,
    visibility: 10,
    timestamp: new Date(NOW - 10 * MINUTE),
    ...over,
  };
}

function asMap(readings: VisibilityReading[]): Map<string, VisibilityReading> {
  return new Map(readings.map((r) => [r.stationId, r]));
}

describe('isVisibilityFresh — age gate', () => {
  it('accepts a recent reading', () => {
    const r = makeReading({ stationId: 'aemet_1690A', timestamp: new Date(NOW - 10 * MINUTE) });
    expect(isVisibilityFresh(r, NOW)).toBe(true);
  });

  it('discards a reading older than the window (AEMET outage froze the store)', () => {
    const r = makeReading({ stationId: 'aemet_1690A', timestamp: new Date(NOW - 3 * HOUR) });
    expect(isVisibilityFresh(r, NOW)).toBe(false);
  });

  it('discards a reading with no timestamp — unprovable freshness fails closed', () => {
    const r = makeReading({ stationId: 'aemet_1690A' });
    // Simulates a reading that lost its timestamp somewhere upstream.
    delete (r as { timestamp?: Date }).timestamp;
    expect(isVisibilityFresh(r, NOW)).toBe(false);
    expect(isVisibilityFresh({ timestamp: null }, NOW)).toBe(false);
    expect(isVisibilityFresh(null, NOW)).toBe(false);
    expect(isVisibilityFresh(undefined, NOW)).toBe(false);
  });

  it('discards an unparseable timestamp', () => {
    expect(isVisibilityFresh({ timestamp: new Date('not a date') }, NOW)).toBe(false);
  });

  it('holds at the exact window boundary and drops just past it', () => {
    const atLimit = makeReading({ stationId: 'a', timestamp: new Date(NOW - VISIBILITY_MAX_AGE_MS) });
    const pastLimit = makeReading({ stationId: 'b', timestamp: new Date(NOW - VISIBILITY_MAX_AGE_MS - 1) });
    expect(isVisibilityFresh(atLimit, NOW)).toBe(true);
    expect(isVisibilityFresh(pastLimit, NOW)).toBe(false);
  });

  it('tolerates mild clock skew but rejects a wildly future timestamp', () => {
    const skewed = makeReading({ stationId: 'a', timestamp: new Date(NOW + 5 * MINUTE) });
    const bogus = makeReading({ stationId: 'b', timestamp: new Date(NOW + 5 * HOUR) });
    expect(isVisibilityFresh(skewed, NOW)).toBe(true);
    expect(isVisibilityFresh(bogus, NOW)).toBe(false);
  });

  it('the same reading expires as time passes without any store update', () => {
    const r = makeReading({ stationId: 'aemet_1690A', timestamp: new Date(NOW) });
    expect(isVisibilityFresh(r, NOW + 30 * MINUTE)).toBe(true);
    expect(isVisibilityFresh(r, NOW + 4 * HOUR)).toBe(false);
  });
});

describe('selectRelevantVisibility — distance gate', () => {
  it('keeps a nearby station (Ourense ~20km from Castrelo)', () => {
    const map = asMap([makeReading({ stationId: 'aemet_1690A', ...OURENSE, visibility: 0.4 })]);
    const out = selectRelevantVisibility(
      map, EMBALSE_CENTER.lat, EMBALSE_CENTER.lon, EMBALSE_GATE_KM, NOW,
    );
    expect(out.size).toBe(1);
    expect(out.has('aemet_1690A')).toBe(true);
  });

  it('drops real fog 110km away (Fisterra) instead of attributing it to the sector', () => {
    const map = asMap([makeReading({ stationId: 'aemet_1400', ...FISTERRA, visibility: 0.2 })]);
    const out = selectRelevantVisibility(
      map, EMBALSE_CENTER.lat, EMBALSE_CENTER.lon, EMBALSE_GATE_KM, NOW,
    );
    expect(out.size).toBe(0);
  });

  it('drops Estaca de Bares too (~170km, north coast)', () => {
    const map = asMap([makeReading({ stationId: 'aemet_1351', ...ESTACA_DE_BARES, visibility: 0.3 })]);
    const out = selectRelevantVisibility(
      map, EMBALSE_CENTER.lat, EMBALSE_CENTER.lon, EMBALSE_GATE_KM, NOW,
    );
    expect(out.size).toBe(0);
  });

  it('applies both gates together — only fresh AND near survives', () => {
    const map = asMap([
      makeReading({ stationId: 'fresh-near', ...OURENSE, timestamp: new Date(NOW - 20 * MINUTE) }),
      makeReading({ stationId: 'stale-near', ...OURENSE, timestamp: new Date(NOW - 5 * HOUR) }),
      makeReading({ stationId: 'fresh-far', ...FISTERRA, timestamp: new Date(NOW - 20 * MINUTE) }),
      makeReading({ stationId: 'stale-far', ...FISTERRA, timestamp: new Date(NOW - 5 * HOUR) }),
    ]);
    const out = selectRelevantVisibility(
      map, EMBALSE_CENTER.lat, EMBALSE_CENTER.lon, EMBALSE_GATE_KM, NOW,
    );
    expect([...out.keys()]).toEqual(['fresh-near']);
  });

  it('returns an empty map rather than a fallback when nothing qualifies', () => {
    const map = asMap([makeReading({ stationId: 'aemet_1400', ...FISTERRA, visibility: 0.1 })]);
    const out = selectRelevantVisibility(
      map, EMBALSE_CENTER.lat, EMBALSE_CENTER.lon, EMBALSE_GATE_KM, NOW,
    );
    expect(out.size).toBe(0);
    expect(minVisibilityKm(out.values())).toBeNull();
  });
});

describe('minVisibilityKm', () => {
  it('returns the worst visibility in the set', () => {
    const map = asMap([
      makeReading({ stationId: 'a', visibility: 12 }),
      makeReading({ stationId: 'b', visibility: 3.5 }),
      makeReading({ stationId: 'c', visibility: 8 }),
    ]);
    expect(minVisibilityKm(map.values())).toBe(3.5);
  });

  it('returns null for an empty set', () => {
    expect(minVisibilityKm([])).toBeNull();
  });

  it('ignores non-finite values', () => {
    const map = asMap([
      makeReading({ stationId: 'a', visibility: NaN }),
      makeReading({ stationId: 'b', visibility: 6 }),
    ]);
    expect(minVisibilityKm(map.values())).toBe(6);
  });

  it('the Fisterra case: global minimum vs sector-gated minimum', () => {
    // Dense fog at Fisterra, clear sky over the Embalse. Before the gate the
    // global minimum (0.2km) reached classifyHaze and bumped calima to
    // 'fuerte' over an inland sector that could see for 15km.
    const all = asMap([
      makeReading({ stationId: 'aemet_1400', ...FISTERRA, visibility: 0.2 }),
      makeReading({ stationId: 'aemet_1690A', ...OURENSE, visibility: 15 }),
    ]);
    expect(minVisibilityKm(all.values())).toBe(0.2); // the old, wrong input
    const gated = selectRelevantVisibility(
      all, EMBALSE_CENTER.lat, EMBALSE_CENTER.lon, EMBALSE_GATE_KM, NOW,
    );
    expect(minVisibilityKm(gated.values())).toBe(15); // what the sector actually sees
  });
});

describe('visibilitySignature — lets staleness invalidate a cache', () => {
  it('is stable regardless of map insertion order', () => {
    const a = asMap([
      makeReading({ stationId: 'x', visibility: 2 }),
      makeReading({ stationId: 'y', visibility: 9 }),
    ]);
    const b = asMap([
      makeReading({ stationId: 'y', visibility: 9 }),
      makeReading({ stationId: 'x', visibility: 2 }),
    ]);
    expect(visibilitySignature(a)).toBe(visibilitySignature(b));
  });

  it('changes when a reading ages out, so a fog alert can be cleared', () => {
    const all = asMap([
      makeReading({ stationId: 'aemet_1690A', ...OURENSE, visibility: 0.5, timestamp: new Date(NOW) }),
    ]);
    const whileFresh = selectRelevantVisibility(
      all, EMBALSE_CENTER.lat, EMBALSE_CENTER.lon, EMBALSE_GATE_KM, NOW,
    );
    // Same frozen Map, four hours later — no store update ever arrived.
    const onceStale = selectRelevantVisibility(
      all, EMBALSE_CENTER.lat, EMBALSE_CENTER.lon, EMBALSE_GATE_KM, NOW + 4 * HOUR,
    );
    expect(visibilitySignature(whileFresh)).not.toBe(visibilitySignature(onceStale));
    expect(visibilitySignature(onceStale)).toBe('');
  });

  it('changes when visibility itself changes, so fog can be raised', () => {
    const clear = asMap([makeReading({ stationId: 'aemet_1690A', visibility: 15 })]);
    const foggy = asMap([makeReading({ stationId: 'aemet_1690A', visibility: 0.4 })]);
    expect(visibilitySignature(clear)).not.toBe(visibilitySignature(foggy));
  });
});
