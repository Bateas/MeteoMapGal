import { describe, it, expect } from 'vitest';
import { exposureWeight, extractWindData, extractBuoyWindData, BUOY_FIELD_WEIGHT, type StationExposure } from './idwInterpolation';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import type { BuoyReading } from '../api/buoyClient';

const exposure = (ratio: number | null, sectors: Record<number, number> = {}): StationExposure => {
  const s: (number | null)[] = Array(8).fill(null);
  for (const [k, v] of Object.entries(sectors)) s[Number(k)] = v;
  return { ratio, sectors: s };
};

describe('exposureWeight', () => {
  it('weighs by the sector of the given direction, squared over 0.6, capped and floored', () => {
    const cies = exposure(0.72, { 0: 0.58, 4: 0.92, 5: 0.97 });   // Illas Cies: blind to the N
    expect(exposureWeight(cies, 5)).toBeCloseTo((0.58 / 0.6) ** 2, 3); // N sector
    expect(exposureWeight(cies, 225)).toBe(1);                           // SW: exposed
    const garden = exposure(0.06, { 0: 0.05 });
    expect(exposureWeight(garden, 0)).toBe(0.05);                        // floor
  });

  it('falls back to the overall ratio, and to 1 without a measurement', () => {
    expect(exposureWeight(exposure(0.3), 90)).toBeCloseTo(0.25, 3);
    expect(exposureWeight(exposure(null), 90)).toBe(1);
    expect(exposureWeight(undefined, 90)).toBe(1);
  });
});

describe('extractWindData with exposure', () => {
  const st = (id: string): NormalizedStation => ({ id, name: id, lat: 42.2, lon: -8.7, altitude: 10, source: 'wunderground', tempOnly: false });
  const rd = (id: string, dir: number): NormalizedReading => ({
    stationId: id, timestamp: new Date(), windSpeed: 2, windGust: null, windDirection: dir,
    temperature: 18, humidity: 70, precipitation: null, solarRadiation: null, pressure: null, dewPoint: null,
  });

  it('keys the sector on the free stream, not on the bent vane of a sheltered station', () => {
    const map = new Map([['wu_a', exposure(0.5, { 0: 0.1, 4: 0.9 })]]);
    const readings = new Map([['wu_a', rd('wu_a', 180)]]);                 // reads S behind a hill, N outside
    const [w] = extractWindData([st('wu_a')], readings, map, 0);
    expect(w.freshness).toBeCloseTo(0.05, 3);
    const [own] = extractWindData([st('wu_a')], readings, map, null);       // no buoys: its own direction
    expect(own.freshness).toBeCloseTo(1, 3);
  });

  it('leaves every station at its freshness when there is no exposure table', () => {
    const [w] = extractWindData([st('wu_a')], new Map([['wu_a', rd('wu_a', 0)]]));
    expect(w.freshness).toBe(1);
  });
});

describe('extractBuoyWindData', () => {
  const buoy = (stationId: number): BuoyReading => ({
    stationId, stationName: String(stationId), timestamp: new Date().toISOString(),
    waveHeight: null, waveHeightMax: null, wavePeriod: null, wavePeriodMean: null, waveDir: null,
    windSpeed: 6, windDir: 0, windGust: null, waterTemp: null, airTemp: null, airPressure: null,
    currentSpeed: null, currentDir: null, salinity: null, seaLevel: null, humidity: null, dewPoint: null,
  });

  it('leaves out the PORTUS copy of a land anemometer and carries the buoy weight', () => {
    const out = extractBuoyWindData([buoy(3221), buoy(4273)], BUOY_FIELD_WEIGHT);
    expect(out).toHaveLength(1);                                           // 4273 = Cabo Udra on land
    expect(out[0].freshness).toBe(BUOY_FIELD_WEIGHT);
  });
});
