import { describe, it, expect } from 'vitest';
import { buildHaloPoints } from './AemetVisibilityHalo';
import { fogLattice } from './fogField';
import type { ElevationAt } from '../../api/demElevation';

// A station on the coast line at lon -8.80: land (20 m) to the east, sea to the west.
const coastal = { id: 'aemet_x', name: 'Costa', lat: 42.2, lon: -8.8, vis: 0.4 };
const shoreline: ElevationAt = (lng) => (lng >= -8.8 ? 20 : -15);
const lngLat = (p: { geometry: { coordinates: number[] } }) => p.geometry.coordinates;

describe('buildHaloPoints (DEM read directly, no terrain)', () => {
  it('paints the sea around a coastal station', () => {
    const overSea = buildHaloPoints(shoreline, [coastal]).filter((p) => lngLat(p)[0] < -8.8);
    expect(overSea.length).toBeGreaterThan(0);
  });

  it('keeps the sea clear for an inland station (the rule terrain never applied)', () => {
    const inlandHigh: ElevationAt = (lng) => (lng >= -8.8 ? 370 : -15);
    for (const p of buildHaloPoints(inlandHigh, [coastal])) {
      expect(lngLat(p)[0]).toBeGreaterThanOrEqual(-8.8);
    }
  });

  it('paints nothing where the ground could not be read', () => {
    const unknown: ElevationAt = () => null;
    expect(buildHaloPoints(unknown, [coastal])).toHaveLength(0);
  });

  it('skips points with unknown ground but keeps the rest', () => {
    const half: ElevationAt = (_lng, lat) => (lat > 42.2 ? null : 5);
    const points = buildHaloPoints(half, [coastal]);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) expect(lngLat(p)[1]).toBeLessThanOrEqual(42.2);
  });
});

describe('fogLattice', () => {
  it('keeps the same spacing on the ground whatever the size of the box', () => {
    const spacingKm = (pts: { lng: number; lat: number }[]) => {
      const row = pts.filter((p) => p.lat === pts[0].lat);
      return [(pts.find((p) => p.lat !== pts[0].lat)!.lat - pts[0].lat) * 111, (row[1].lng - row[0].lng) * 111 * Math.cos((42.2 * Math.PI) / 180)];
    };
    const small = fogLattice({ west: -8.82, east: -8.78, south: 42.18, north: 42.22 });
    const large = fogLattice({ west: -9, east: -8.5, south: 42, north: 42.4 });
    expect(spacingKm(small)[0]).toBeCloseTo(0.4, 5);
    expect(spacingKm(small)[1]).toBeCloseTo(0.4, 2);
    expect(spacingKm(large)[0]).toBeCloseTo(0.4, 5);
    expect(spacingKm(large)[1]).toBeCloseTo(0.4, 1);
  });

  it('stays inside the box', () => {
    for (const p of fogLattice({ west: -8.82, east: -8.78, south: 42.18, north: 42.22 })) {
      expect(p.lng).toBeGreaterThan(-8.82);
      expect(p.lng).toBeLessThan(-8.78);
      expect(p.lat).toBeGreaterThan(42.18);
      expect(p.lat).toBeLessThan(42.22);
    }
  });
});
