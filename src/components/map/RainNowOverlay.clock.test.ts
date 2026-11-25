import { describe, expect, it } from 'vitest';
import { arrivalClock, arrowGeo, arrowOverhangKm, ARROW_INSIDE_KM } from './RainNowOverlay';

describe('arrivalClock: the hour written at the tip of the arrow of rain coming to the sector', () => {
  it('adds the minutes and rounds to five, in Madrid time (winter: UTC+1)', () => {
    expect(arrivalClock(Date.UTC(2026, 10, 11, 16, 42), 25)).toBe('~18:05');
    expect(arrivalClock(Date.UTC(2026, 10, 11, 16, 44), 25)).toBe('~18:10');
  });

  it('summer time and the change of day', () => {
    expect(arrivalClock(Date.UTC(2026, 6, 1, 21, 50), 40)).toBe('~00:30');
  });
});

describe('arrowGeo: the arrow sits on the front of its patch (18-nov: they lay whole over dry ground)', () => {
  const edge = { lon: -8.0, lat: 42.3 };
  const kmEast = (lon: number) => (lon - edge.lon) * 111.32 * Math.cos((edge.lat * Math.PI) / 180);
  it('starts inside the rain, behind the front, and sticks out only a little ahead', () => {
    const shaft = arrowGeo(edge, ARROW_INSIDE_KM, arrowOverhangKm(46), 90, 'flow').features.find((f) => f.properties?.part === 'shaft')!;
    const [start, tip] = (shaft.geometry as GeoJSON.LineString).coordinates;
    expect(kmEast(start[0])).toBeCloseTo(-ARROW_INSIDE_KM, 1);
    expect(kmEast(tip[0])).toBeCloseTo(4.6, 1);
    // The old arrow ran the half hour ahead of the front: 23 km at 46 km/h
    expect(kmEast(tip[0])).toBeLessThan(23 / 4);
  });
  it('the overhang grows with the speed between 2 and 5 km', () => {
    expect([5, 30, 46, 120].map((k) => Math.round(arrowOverhangKm(k) * 10) / 10)).toEqual([2, 3, 4.6, 5]);
  });
});
