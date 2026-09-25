import { describe, it, expect } from 'vitest';
import { tilePixel, terrariumMeters, stationAltitudeFromDem, DEM_ZOOM } from './demElevation';

describe('tilePixel', () => {
  it('finds the zoom-12 tile and pixel of a point (Castrelo, checked against the live tile)', () => {
    expect(DEM_ZOOM).toBe(12);
    expect(tilePixel(42.29, -8.1)).toEqual({ x: 1955, y: 1516, px: 215, py: 14 });
  });

  it('keeps the pixel inside the tile', () => {
    for (const [lat, lon] of [[42.0, -8.0], [43.79, -9.3], [41.8, -6.73]]) {
      const t = tilePixel(lat, lon);
      expect(t.px).toBeGreaterThanOrEqual(0);
      expect(t.px).toBeLessThan(256);
      expect(t.py).toBeGreaterThanOrEqual(0);
      expect(t.py).toBeLessThan(256);
    }
  });
});

describe('terrariumMeters', () => {
  it('decodes the Terrarium encoding', () => {
    expect(terrariumMeters(128, 0, 0)).toBe(0);                 // sea level
    expect(terrariumMeters(128, 124, 76)).toBeCloseTo(124.3, 1); // the Castrelo pixel
    expect(terrariumMeters(127, 246, 0)).toBe(-10);             // bathymetry below the sea
  });
});

describe('stationAltitudeFromDem', () => {
  it('rounds to the metre, which is as good as the model gets', () => {
    expect(stationAltitudeFromDem(124.3)).toBe(124);
  });

  it('puts a station whose pixel falls on the water at the coast, never at the 0 that means unknown', () => {
    expect(stationAltitudeFromDem(-12)).toBe(1);
    expect(stationAltitudeFromDem(0.2)).toBe(1);
  });

  it('gives nothing for a value that is not a number', () => {
    expect(stationAltitudeFromDem(Number.NaN)).toBeNull();
  });
});
