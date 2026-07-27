/**
 * Tests for fireClustering — hotspot pixels → fires.
 *
 * This is the layer that stops the app claiming "37 focos activos" when three
 * things are burning. A bug here is a lie on screen during a fire emergency.
 */

import { describe, it, expect } from 'vitest';
import {
  clusterFires,
  selectFireClusters,
  clusterAgeMin,
  isFireActive,
  canDrawSmoke,
  FIRE_ACTIVE_MAX_MIN,
  FIRE_SMOKE_MAX_MIN,
} from './fireClustering';
import type { ActiveFire } from '../types/fire';

/** Build a detection. Defaults sit on a Galician hillside, midday, nominal. */
function hs(over: Partial<ActiveFire> = {}): ActiveFire {
  const lat = over.lat ?? 42.3;
  const lon = over.lon ?? -8.5;
  const acquiredAt = over.acquiredAt ?? new Date('2026-07-26T12:00:00Z');
  return {
    id: over.id ?? `${lat}_${lon}_${acquiredAt.toISOString()}_${over.satellite ?? 'N'}`,
    lat,
    lon,
    brightness: over.brightness ?? 340,
    frp: over.frp ?? 10,
    acquiredAt,
    satellite: over.satellite ?? 'N',
    confidence: over.confidence ?? 'nominal',
    daynight: over.daynight ?? 'D',
  };
}

/** Offset in km → degrees, for building fixtures at a known separation. */
function shiftLat(lat: number, km: number): number {
  return lat + km / 111;
}

describe('clusterFires — the same fire seen many times is ONE fire', () => {
  it('returns an empty list for no detections', () => {
    expect(clusterFires([])).toEqual([]);
  });

  it('keeps a lone detection as a valid one-hotspot fire', () => {
    const out = clusterFires([hs({ frp: 4 })]);
    expect(out).toHaveLength(1);
    expect(out[0].hotspotCount).toBe(1);
    expect(out[0].frpMw).toBe(4);
    expect(out[0].satellites).toEqual(['N']);
  });

  it('collapses two satellites over the same point into ONE fire', () => {
    // S-NPP and NOAA-20 see the same flames ~50 min apart. That is one fire.
    const out = clusterFires([
      hs({ satellite: 'N', acquiredAt: new Date('2026-07-26T12:00:00Z') }),
      hs({ satellite: 'N20', acquiredAt: new Date('2026-07-26T12:50:00Z') }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].hotspotCount).toBe(2);
    expect(out[0].satellites).toEqual(['N', 'N20']);
  });

  it('collapses three passes over the same point into ONE fire', () => {
    const out = clusterFires([
      hs({ id: 'a', acquiredAt: new Date('2026-07-26T02:00:00Z') }),
      hs({ id: 'b', acquiredAt: new Date('2026-07-26T12:00:00Z') }),
      hs({ id: 'c', acquiredAt: new Date('2026-07-26T14:00:00Z') }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].hotspotCount).toBe(3);
    expect(out[0].firstAt.toISOString()).toBe('2026-07-26T02:00:00.000Z');
    expect(out[0].latestAt.toISOString()).toBe('2026-07-26T14:00:00.000Z');
  });

  it('keeps two fires 50 km apart separate', () => {
    const out = clusterFires([hs({ lat: 42.3 }), hs({ lat: shiftLat(42.3, 50), id: 'far' })]);
    expect(out).toHaveLength(2);
  });

  it('merges a multi-pixel front but not the neighbouring valley', () => {
    // Front: three contiguous 375m pixels. Separate fire 8 km away.
    const out = clusterFires([
      hs({ id: 'p1', lat: 42.300 }),
      hs({ id: 'p2', lat: 42.303 }),
      hs({ id: 'p3', lat: 42.306 }),
      hs({ id: 'other', lat: shiftLat(42.3, 8) }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.hotspotCount).sort()).toEqual([1, 3]);
  });
});

describe('clusterFires — intensity is the newest pass, not the sum of the day', () => {
  it('frpMw sums only the most recent pass', () => {
    // Same fire, two passes. Morning burned at 100 MW total, the newest pass
    // reads 30 MW: the fire is dying down, so the answer is 30, never 130.
    const out = clusterFires([
      hs({ id: 'm1', frp: 60, acquiredAt: new Date('2026-07-26T02:00:00Z') }),
      hs({ id: 'm2', frp: 40, acquiredAt: new Date('2026-07-26T02:00:00Z'), lat: 42.302 }),
      hs({ id: 'n1', frp: 20, acquiredAt: new Date('2026-07-26T13:00:00Z') }),
      hs({ id: 'n2', frp: 10, acquiredAt: new Date('2026-07-26T13:00:00Z'), lat: 42.302 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].frpMw).toBe(30);
  });

  it('does not add the other satellite pass into the newest one', () => {
    // Two satellites 50 min apart: separate looks at the same fire.
    const out = clusterFires([
      hs({ id: 's1', frp: 25, satellite: 'N', acquiredAt: new Date('2026-07-26T12:00:00Z') }),
      hs({ id: 's2', frp: 40, satellite: 'N20', acquiredAt: new Date('2026-07-26T12:50:00Z') }),
    ]);
    expect(out[0].frpMw).toBe(40);
  });

  it('sums the pixels WITHIN one pass — that is one front at one instant', () => {
    const at = new Date('2026-07-26T13:00:00Z');
    const out = clusterFires([
      hs({ id: 'a', frp: 12, acquiredAt: at }),
      hs({ id: 'b', frp: 8, acquiredAt: at, lat: 42.303 }),
      hs({ id: 'c', frp: 5, acquiredAt: at, lat: 42.306 }),
    ]);
    expect(out[0].frpMw).toBe(25);
  });
});

describe('clusterFires — centroid and metadata', () => {
  it('weights the centroid by FRP: the strongest pixel pulls hardest', () => {
    const out = clusterFires([
      hs({ id: 'weak', lat: 42.300, frp: 1 }),
      hs({ id: 'strong', lat: 42.310, frp: 99 }),
    ]);
    expect(out).toHaveLength(1);
    // Plain mean would be 42.305; FRP weighting lands next to the strong pixel.
    expect(out[0].lat).toBeGreaterThan(42.308);
    expect(out[0].lat).toBeLessThanOrEqual(42.310);
  });

  it('falls back to the plain mean when every FRP is zero', () => {
    const out = clusterFires([
      hs({ id: 'z1', lat: 42.300, frp: 0 }),
      hs({ id: 'z2', lat: 42.310, frp: 0 }),
    ]);
    expect(out[0].lat).toBeCloseTo(42.305, 4);
    expect(out[0].frpMw).toBe(0);
  });

  it('reports the best confidence in the group', () => {
    const out = clusterFires([
      hs({ id: 'n', confidence: 'nominal' }),
      hs({ id: 'h', confidence: 'high', lat: 42.302 }),
    ]);
    expect(out[0].maxConfidence).toBe('high');
  });

  it('is order-independent — the CSV row order cannot change the answer', () => {
    const rows = [
      hs({ id: 'a', lat: 42.300, frp: 5 }),
      hs({ id: 'b', lat: 42.303, frp: 50 }),
      hs({ id: 'c', lat: shiftLat(42.3, 40), frp: 9 }),
    ];
    const forward = clusterFires(rows);
    const backward = clusterFires(rows.slice().reverse());
    expect(forward.map((c) => c.id).sort()).toEqual(backward.map((c) => c.id).sort());
  });
});

describe('clusterFires — the radius is not a delicate parameter', () => {
  // Mirrors the live July 2026 shape: two multi-pixel fires plus a lone one,
  // all separated by far more than the radius band under test.
  const fixture: ActiveFire[] = [
    hs({ id: 'f1a', lat: 42.300, lon: -8.500, frp: 40 }),
    hs({ id: 'f1b', lat: 42.303, lon: -8.500, frp: 25 }),
    hs({ id: 'f1c', lat: 42.301, lon: -8.497, frp: 15 }),
    hs({ id: 'f2a', lat: shiftLat(42.3, 30), lon: -8.500, frp: 60 }),
    hs({ id: 'f2b', lat: shiftLat(42.3, 30.02), lon: -8.500, frp: 30 }),
    hs({ id: 'f3', lat: shiftLat(42.3, 70), lon: -8.500, frp: 8 }),
  ];

  it('gives the same three fires at 1.0, 2.0 and 3.0 km', () => {
    const shapes = [1.0, 2.0, 3.0].map((r) =>
      clusterFires(fixture, r)
        .map((c) => c.hotspotCount)
        .sort((a, b) => a - b)
        .join('/'),
    );
    expect(shapes).toEqual(['1/2/3', '1/2/3', '1/2/3']);
  });
});

describe('age gates — "active" is a claim that expires', () => {
  const now = new Date('2026-07-26T18:00:00Z').getTime();
  const at = (minAgo: number) =>
    clusterFires([hs({ acquiredAt: new Date(now - minAgo * 60_000) })])[0];

  it('measures age from the most recent detection', () => {
    expect(clusterAgeMin(at(45), now)).toBeCloseTo(45, 5);
  });

  it('calls a fresh detection active and an old one not', () => {
    expect(isFireActive(at(FIRE_ACTIVE_MAX_MIN - 1), now)).toBe(true);
    expect(isFireActive(at(FIRE_ACTIVE_MAX_MIN + 1), now)).toBe(false);
  });

  it('holds smoke to a stricter window than the active claim', () => {
    expect(FIRE_SMOKE_MAX_MIN).toBeLessThan(FIRE_ACTIVE_MAX_MIN);
    expect(canDrawSmoke(at(FIRE_SMOKE_MAX_MIN - 1), now)).toBe(true);
    // Still an "active" fire, but too old to cross with the wind blowing now.
    const stale = at(FIRE_SMOKE_MAX_MIN + 60);
    expect(canDrawSmoke(stale, now)).toBe(false);
    expect(isFireActive(stale, now)).toBe(true);
  });
});

describe('selectFireClusters — one list for every surface', () => {
  it('returns the identical objects for the same store array', () => {
    const fires = [hs()];
    expect(selectFireClusters(fires)).toBe(selectFireClusters(fires));
  });

  it('recomputes when the store publishes a new array', () => {
    const first = selectFireClusters([hs({ id: 'one' })]);
    const second = selectFireClusters([hs({ id: 'one' }), hs({ id: 'two', lat: 43.5 })]);
    expect(first).not.toBe(second);
    expect(second).toHaveLength(2);
  });
});
