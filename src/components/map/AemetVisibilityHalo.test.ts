import { describe, it, expect } from 'vitest';
import { buildHaloGeoJSON } from './AemetVisibilityHalo';
import type { ElevationAt } from '../../api/demElevation';

// A station on the coast line at lon -8.80: land (20 m) to the east, sea to the west.
const coastal = { id: 'aemet_x', name: 'Costa', lat: 42.2, lon: -8.8, vis: 0.4 };
const shoreline: ElevationAt = (lng) => (lng >= -8.8 ? 20 : -15);

describe('buildHaloGeoJSON (DEM read directly, no terrain)', () => {
  it('paints the sea around a coastal station', () => {
    const fc = buildHaloGeoJSON(shoreline, [coastal]);
    const overSea = fc.features.filter((f) => {
      const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
      return ring[1][0] < -8.8; // cell entirely west of the shore
    });
    expect(overSea.length).toBeGreaterThan(0);
  });

  it('keeps the sea clear for an inland station (the rule terrain never applied)', () => {
    const inlandHigh: ElevationAt = (lng) => (lng >= -8.8 ? 370 : -15);
    const fc = buildHaloGeoJSON(inlandHigh, [coastal]);
    for (const f of fc.features) {
      const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
      expect(ring[0][0]).toBeGreaterThanOrEqual(-8.8 - 1e-9);
    }
  });

  it('paints nothing where the ground could not be read', () => {
    const unknown: ElevationAt = () => null;
    expect(buildHaloGeoJSON(unknown, [coastal]).features).toHaveLength(0);
  });

  it('skips cells with unknown ground but keeps the rest', () => {
    const half: ElevationAt = (lng, lat) => (lat > 42.2 ? null : 5);
    const fc = buildHaloGeoJSON(half, [coastal]);
    expect(fc.features.length).toBeGreaterThan(0);
    for (const f of fc.features) {
      const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
      expect(ring[0][1]).toBeLessThanOrEqual(42.2);
    }
  });
});
