import { describe, it, expect } from 'vitest';
import { publicLatLon, withPublicLocation } from './publicLocation';

describe('publicLocation — private stations are shown near, not at, the home (29-sep)', () => {
  it('rounds a Netatmo position to 3 decimals (the API gave 13)', () => {
    expect(publicLatLon('netatmo', 42.0517818131998, -8.65033416536123)).toEqual({ lat: 42.052, lon: -8.65 });
  });

  it('stays within ~70 m of the real point', () => {
    const lat = 42.0517818131998, lon = -8.65033416536123;
    const p = publicLatLon('wunderground', lat, lon);
    const dy = (p.lat - lat) * 111_000, dx = (p.lon - lon) * 111_000 * Math.cos((lat * Math.PI) / 180);
    expect(Math.hypot(dx, dy)).toBeLessThan(70);
  });

  it('leaves official networks, buoys and unknown sources exact', () => {
    for (const s of ['meteogalicia', 'aemet', 'ipma', 'skyx', null]) {
      expect(publicLatLon(s, 42.0517818131998, -8.65033416536123)).toEqual({ lat: 42.0517818131998, lon: -8.65033416536123 });
    }
  });

  it('rounds every private row of a list and keeps the rest of each row', () => {
    const rows = withPublicLocation([
      { station_id: 'mc_X', source: 'meteoclimatic', lat: 42.12345, lon: -8.54321, name: 'Baiona' },
      { station_id: 'mg_1', source: 'meteogalicia', lat: 42.12345, lon: -8.54321, name: 'Ons' },
    ]);
    expect(rows[0]).toEqual({ station_id: 'mc_X', source: 'meteoclimatic', lat: 42.123, lon: -8.543, name: 'Baiona' });
    expect(rows[1].lat).toBe(42.12345);
  });
});
