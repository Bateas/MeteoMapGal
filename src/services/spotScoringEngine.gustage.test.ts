/**
 * The gust a spot shows only comes from readings of the last hour (29-sep, 21:13: Cesantes and
 * the Bocana showed «racha 41» with 8-10 kt, from Vigo airport's reading of 20:00).
 */
import { describe, it, expect } from 'vitest';
import { reportedGustKt, gustIsCurrent, GUST_SHOWN_MAX_AGE_MIN, spotGustKt, waterLevelMaxAltitudeM, type GustSource } from './spotScoringEngine';
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

describe('spotGustKt — at the height of the water (30-sep, Cesantes)', () => {
  // 15:40 of 30-sep from the database: O Viso mg_10154 (260 m, 2.1 km), mg_10175 (273 m,
  // 7.6 km), and a shore station at 19 m.
  const src = (distKm: number, altitudeM: number | null, meanKt: number, gustKt: number): GustSource =>
    ({ distKm, altitudeM, meanKt, gustKt, time: new Date(NOW - 5 * 60_000) });

  it('15:40: the hill gusts (17 and 14 kt) do not reach the water; the shore station does', () => {
    expect(spotGustKt([src(2.1, 260, 9.3, 17.4), src(7.6, 273, 4.1, 14.2), src(1.7, 19, 3.9, 5.8)], NOW, 150)).toBeCloseTo(5.8, 1);
  });

  it('with only hill stations around, the spot shows no gust', () => {
    expect(spotGustKt([src(2.1, 260, 9.3, 17.4), src(7.6, 273, 4.1, 14.2)], NOW, 150)).toBeNull();
  });

  it('an unknown altitude counts, and a buoy is at sea level', () => {
    expect(spotGustKt([src(3, null, 10, 16)], NOW, 150)).toBeCloseTo(16, 1);
    expect(spotGustKt([src(5, 0, 12, 18)], NOW, 150)).toBeCloseTo(18, 1);
  });

  it('the limit follows the sector: 250 m at Castrelo, 150 m on the coast and for a user pin', () => {
    expect(waterLevelMaxAltitudeM('castrelo')).toBe(250);
    expect(waterLevelMaxAltitudeM('cesantes')).toBe(150);
    expect(waterLevelMaxAltitudeM('user-123')).toBe(150);
    const s = [src(3, 200, 8, 14)];
    expect(spotGustKt(s, NOW, 250)).toBeCloseTo(14, 1);
    expect(spotGustKt(s, NOW, 150)).toBeNull();
  });

  it('the map reads the altitude from the station', () => {
    const r = reading('mg_10154', 9.3, 17.4, 5);
    expect(reportedGustKt([{ reading: r, distKm: 2.1, station: { altitude: 260 } }], [], NOW)).toBeNull();
    expect(reportedGustKt([{ reading: r, distKm: 2.1, station: { altitude: 19 } }], [], NOW)).toBeCloseTo(17.4, 1);
  });
});
