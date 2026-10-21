/**
 * `/api/v1/metar/latest` rows (21-oct audit, finding 14): the map reads the newest stored METAR
 * of each airport instead of asking aviationweather.gov through our proxy as well.
 */
import { describe, it, expect } from 'vitest';
import { latestMetarRows } from './queries';

describe('latestMetarRows', () => {
  it('turns the driver strings into numbers (bigint and REAL arrive as text)', () => {
    expect(latestMetarRows([
      { icao: 'LEVX', t: '1792573200000', visibility_km: '0.4', raw_ob: 'METAR LEVX 210900Z 0400 FG' },
    ])).toEqual([{ icao: 'LEVX', obsTime: 1792573200000, visibilityKm: 0.4, rawOb: 'METAR LEVX 210900Z 0400 FG' }]);
  });

  it('keeps a report without visibility (the map drops it) and drops rows without time or text', () => {
    expect(latestMetarRows([
      { icao: 'LEST', t: 1792573200000, visibility_km: null, raw_ob: 'METAR LEST 210900Z' },
      { icao: 'LECO', t: 'x', visibility_km: 10, raw_ob: 'METAR LECO' },
      { icao: 'LECO', t: 1792573200000, visibility_km: 10, raw_ob: '' },
    ])).toEqual([{ icao: 'LEST', obsTime: 1792573200000, visibilityKm: null, rawOb: 'METAR LEST 210900Z' }]);
  });
});
