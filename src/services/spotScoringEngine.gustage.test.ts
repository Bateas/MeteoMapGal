/**
 * The gust a spot shows only comes from readings of the last hour (29-sep, 21:13: Cesantes and
 * the Bocana showed «racha 41» with 8-10 kt, from Vigo airport's reading of 20:00).
 */
import { describe, it, expect } from 'vitest';
import { reportedGustKt, gustIsCurrent, GUST_SHOWN_MAX_AGE_MIN, spotGustKt, type GustSource } from './spotScoringEngine';
import type { NormalizedReading } from '../types/station';
import type { BuoyReading } from '../api/buoyClient';

const kt = (v: number) => v / 1.94384;
const NOW = Date.UTC(2026, 8, 29, 19, 13);

function reading(id: string, meanKt: number, gustKt: number, ageMin: number): NormalizedReading {
  return {
    stationId: id, timestamp: new Date(NOW - ageMin * 60_000), windSpeed: kt(meanKt), windGust: kt(gustKt),
    windDirection: 200, temperature: 17, humidity: 90, precipitation: null, solarRadiation: null, pressure: 1009, dewPoint: 15,
  };
}

describe('reportedGustKt — only gusts of the last hour', () => {
  it('Vigo airport at 20:00 (73 min old, 41 kt) is not the gust at 21:13; the fresh one is', () => {
    const g = reportedGustKt([
      { reading: reading('aemet_1495', 19, 41, 73), distKm: 5 },
      { reading: reading('mg_10154', 9, 18, 5), distKm: 2 },
    ], [], NOW);
    expect(g).toBeCloseTo(18, 0);
  });

  it('within the hour the gust still counts', () => {
    const g = reportedGustKt([{ reading: reading('aemet_1495', 19, 41, 50), distKm: 5 }], [], NOW);
    expect(g).toBeCloseTo(41, 0);
  });

  it('an old buoy gust does not count either', () => {
    const buoy = { stationId: 4273, timestamp: new Date(NOW - 90 * 60_000).toISOString(), windSpeed: kt(30), windGust: kt(45) } as unknown as BuoyReading;
    expect(reportedGustKt([], [{ buoy, distKm: 5 }], NOW)).toBeNull();
  });

  it('gustIsCurrent: no time (fixtures) counts; the limit is one hour', () => {
    expect(GUST_SHOWN_MAX_AGE_MIN).toBe(60);
    expect(gustIsCurrent(undefined, NOW)).toBe(true);
    expect(gustIsCurrent(new Date(NOW - 59 * 60_000), NOW)).toBe(true);
    expect(gustIsCurrent(new Date(NOW - 61 * 60_000), NOW)).toBe(false);
  });
});

describe('spotGustKt — sources within 8 km, buoys included (30-sep, 17:23)', () => {
  const src = (distKm: number, meanKt: number, gustKt: number): GustSource =>
    ({ distKm, meanKt, gustKt, time: new Date(NOW - 5 * 60_000) });

  it('the burst at the Vigo tide gauge, 12 km away, is not a Cesantes gust', () => {
    expect(spotGustKt([src(11.8, 18.5, 22), src(1.7, 3.9, 5.8)], NOW)).toBeCloseTo(5.8, 1);
  });

  it('a buoy within 8 km still counts, and a blacklisted station does not', () => {
    expect(spotGustKt([src(7.5, 12, 18)], NOW)).toBeCloseTo(18, 1);
    expect(spotGustKt([{ ...src(2, 10, 16), blacklisted: true }], NOW)).toBeNull();
  });

  it('the map gives buoys the same 8 km', () => {
    const buoy = { stationId: 3221, timestamp: new Date(NOW - 5 * 60_000).toISOString(), windSpeed: kt(18.5), windGust: kt(22) } as unknown as BuoyReading;
    expect(reportedGustKt([], [{ buoy, distKm: 11.8 }], NOW)).toBeNull();
    expect(reportedGustKt([], [{ buoy, distKm: 7.9 }], NOW)).toBeCloseTo(22, 0);
  });
});
