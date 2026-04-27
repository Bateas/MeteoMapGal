/**
 * Tests for smokePlumeService — fan-shaped plume geometry from FIRMS fires.
 *
 * Pure functions. Bug here = wrong plume direction (drift opposite to
 * actual smoke), wrong length, or empty polygons.
 */

import { describe, it, expect } from 'vitest';
import {
  nearestWindFromStations,
  plumeLengthKm,
  buildPlumePolygon,
  buildPlume,
  buildAllPlumes,
  plumeImpactPoint,
} from './smokePlumeService';
import type { ActiveFire } from '../types/fire';

function makeFire(overrides: Partial<ActiveFire> = {}): ActiveFire {
  return {
    id: 'fire1',
    lat: 42.5,
    lon: -8.5,
    brightness: 350,
    frp: 25,
    acquiredAt: new Date('2026-04-27T13:00:00Z'),
    satellite: 'N',
    confidence: 'nominal',
    daynight: 'D',
    ...overrides,
  };
}

// ── nearestWindFromStations ──────────────────────────

describe('nearestWindFromStations', () => {
  it('returns null when no stations', () => {
    expect(nearestWindFromStations(42.5, -8.5, [])).toBeNull();
  });

  it('skips stations with null wind direction', () => {
    const stations = [
      { lat: 42.5, lon: -8.5, windDirDeg: null, windKt: 10 },
    ];
    expect(nearestWindFromStations(42.5, -8.5, stations)).toBeNull();
  });

  it('skips calm stations (wind <1kt)', () => {
    const stations = [
      { lat: 42.5, lon: -8.5, windDirDeg: 270, windKt: 0.5 },
    ];
    expect(nearestWindFromStations(42.5, -8.5, stations)).toBeNull();
  });

  it('skips stations beyond maxKm', () => {
    // Madrid ~465km from Vigo
    const stations = [
      { lat: 40.4, lon: -3.7, windDirDeg: 270, windKt: 10 },
    ];
    expect(nearestWindFromStations(42.5, -8.5, stations, 80)).toBeNull();
  });

  it('returns the nearest valid station', () => {
    const stations = [
      { lat: 42.7, lon: -8.5, windDirDeg: 270, windKt: 10 }, // ~22km
      { lat: 42.55, lon: -8.5, windDirDeg: 90, windKt: 12 }, // ~5.5km — nearer
    ];
    const r = nearestWindFromStations(42.5, -8.5, stations);
    expect(r?.dirDeg).toBe(90);
    expect(r?.speedKt).toBe(12);
  });
});

// ── plumeLengthKm ────────────────────────────────────

describe('plumeLengthKm', () => {
  it('returns 3km for tiny fires (FRP <1)', () => {
    expect(plumeLengthKm(0.5)).toBe(3);
    expect(plumeLengthKm(0)).toBe(3);
  });

  it('scales logarithmically: 1MW → 3km', () => {
    expect(plumeLengthKm(1)).toBe(3);
  });

  it('10MW → ~7km', () => {
    expect(plumeLengthKm(10)).toBeCloseTo(7, 0);
  });

  it('100MW → ~11km', () => {
    expect(plumeLengthKm(100)).toBeCloseTo(11, 0);
  });

  it('caps at 15km for extreme fires', () => {
    expect(plumeLengthKm(10000)).toBe(15);
  });

  it('handles non-finite input gracefully', () => {
    expect(plumeLengthKm(NaN)).toBe(3);
    expect(plumeLengthKm(-5)).toBe(3);
  });
});

// ── buildPlumePolygon ────────────────────────────────

describe('buildPlumePolygon', () => {
  it('returns a closed ring (first and last point identical)', () => {
    const poly = buildPlumePolygon(42.5, -8.5, 90, 5);
    expect(poly).toHaveLength(1); // single ring
    const ring = poly[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('drifts east when bearingTo = 90 (longitude increases)', () => {
    const poly = buildPlumePolygon(42.5, -8.5, 90, 10);
    const ring = poly[0];
    // Origin at index 0 has lon -8.5. Far points should have lon > -8.5
    const farLons = ring.slice(1, -1).map((p) => p[0]);
    expect(Math.min(...farLons)).toBeGreaterThan(-8.5);
  });

  it('drifts north when bearingTo = 0', () => {
    const poly = buildPlumePolygon(42.5, -8.5, 0, 10);
    const ring = poly[0];
    const farLats = ring.slice(1, -1).map((p) => p[1]);
    expect(Math.min(...farLats)).toBeGreaterThan(42.5);
  });

  it('drifts south when bearingTo = 180', () => {
    const poly = buildPlumePolygon(42.5, -8.5, 180, 10);
    const ring = poly[0];
    const farLats = ring.slice(1, -1).map((p) => p[1]);
    expect(Math.max(...farLats)).toBeLessThan(42.5);
  });

  it('longer fans cover more distance', () => {
    const short = buildPlumePolygon(42.5, -8.5, 90, 3);
    const long = buildPlumePolygon(42.5, -8.5, 90, 12);
    const shortMaxLon = Math.max(...short[0].map((p) => p[0]));
    const longMaxLon = Math.max(...long[0].map((p) => p[0]));
    expect(longMaxLon).toBeGreaterThan(shortMaxLon);
  });

  it('respects custom fan angle', () => {
    // A 5° fan should be much narrower than a 60° fan
    const narrow = buildPlumePolygon(42.5, -8.5, 90, 10, 5);
    const wide = buildPlumePolygon(42.5, -8.5, 90, 10, 60);
    const narrowLatRange =
      Math.max(...narrow[0].map((p) => p[1])) - Math.min(...narrow[0].map((p) => p[1]));
    const wideLatRange =
      Math.max(...wide[0].map((p) => p[1])) - Math.min(...wide[0].map((p) => p[1]));
    expect(wideLatRange).toBeGreaterThan(narrowLatRange * 2);
  });
});

// ── buildPlume ───────────────────────────────────────

describe('buildPlume', () => {
  it('returns null for calm wind (<2kt)', () => {
    expect(buildPlume(makeFire(), { dirDeg: 270, speedKt: 1 })).toBeNull();
  });

  it('flips wind FROM direction to drift TO direction', () => {
    // Wind FROM the west (270°) → smoke drifts east (90°)
    const plume = buildPlume(makeFire({ lat: 42.5, lon: -8.5 }), { dirDeg: 270, speedKt: 10 });
    expect(plume).not.toBeNull();
    expect(plume!.bearingTo).toBe(90);
    // Verify polygon coordinates drift east
    const farLons = plume!.polygon[0].slice(1, -1).map((p) => p[0]);
    expect(Math.min(...farLons)).toBeGreaterThan(-8.5);
  });

  it('handles 360° wraparound (wind from 350° → drift to 170°)', () => {
    const plume = buildPlume(makeFire(), { dirDeg: 350, speedKt: 10 });
    expect(plume!.bearingTo).toBe(170);
  });

  it('embeds the source fire ID', () => {
    const fire = makeFire({ id: 'pontevedra-foco-1' });
    const plume = buildPlume(fire, { dirDeg: 270, speedKt: 10 });
    expect(plume!.fireId).toBe('pontevedra-foco-1');
  });

  it('plume length scales with fire FRP', () => {
    const small = buildPlume(makeFire({ frp: 1 }), { dirDeg: 270, speedKt: 10 });
    const big = buildPlume(makeFire({ frp: 100 }), { dirDeg: 270, speedKt: 10 });
    expect(big!.lengthKm).toBeGreaterThan(small!.lengthKm);
  });
});

// ── buildAllPlumes ───────────────────────────────────

describe('buildAllPlumes', () => {
  const stations = [
    { lat: 42.5, lon: -8.5, windDirDeg: 270, windKt: 10 },
  ];

  it('returns empty array when no fires', () => {
    expect(buildAllPlumes([], stations)).toEqual([]);
  });

  it('returns empty array when no stations have wind', () => {
    expect(buildAllPlumes([makeFire()], [])).toEqual([]);
  });

  it('builds one plume per fire with valid nearest wind', () => {
    const fires = [makeFire({ id: 'f1', lat: 42.5, lon: -8.5 }), makeFire({ id: 'f2', lat: 42.6, lon: -8.4 })];
    const plumes = buildAllPlumes(fires, stations);
    expect(plumes).toHaveLength(2);
    expect(plumes.map((p) => p.fireId).sort()).toEqual(['f1', 'f2']);
  });

  it('skips fires with no nearby wind', () => {
    // Fire in Madrid, station only in Galicia (>465km away, beyond default 80km)
    const fires = [makeFire({ lat: 40.4, lon: -3.7 })];
    expect(buildAllPlumes(fires, stations)).toHaveLength(0);
  });
});

// ── plumeImpactPoint ─────────────────────────────────

describe('plumeImpactPoint', () => {
  it('returns a point downwind of the fire origin', () => {
    const plume = buildPlume(makeFire({ lat: 42.5, lon: -8.5 }), { dirDeg: 270, speedKt: 10 });
    const [impactLon, impactLat] = plumeImpactPoint(plume!);
    // Wind from west → smoke drifts east. Impact lon should be greater than origin lon (-8.5)
    expect(impactLon).toBeGreaterThan(-8.5);
    // Latitude roughly preserved
    expect(impactLat).toBeCloseTo(42.5, 0);
  });
});
