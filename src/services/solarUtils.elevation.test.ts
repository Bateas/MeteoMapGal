import { describe, it, expect } from 'vitest';
import { solarElevationDeg } from './solarUtils';

describe('solarElevationDeg', () => {
  const vigo = { lat: 42.24, lon: -8.72 };
  it('late September at Vigo: about 45 degrees at solar noon (~12:40 UTC)', () => {
    expect(solarElevationDeg(Date.parse('2026-09-29T12:40:00Z'), vigo.lat, vigo.lon)).toBeCloseTo(45.5, 0);
  });
  it('below the horizon at night, near it at sunset (~18:15 UTC, 20:15 local)', () => {
    expect(solarElevationDeg(Date.parse('2026-09-29T22:00:00Z'), vigo.lat, vigo.lon)).toBeLessThan(-20);
    expect(Math.abs(solarElevationDeg(Date.parse('2026-09-29T18:15:00Z'), vigo.lat, vigo.lon))).toBeLessThan(2);
  });
  it('midsummer noon is higher: ~71 degrees', () => {
    expect(solarElevationDeg(Date.parse('2026-06-21T12:35:00Z'), vigo.lat, vigo.lon)).toBeCloseTo(71, 0);
  });
});
