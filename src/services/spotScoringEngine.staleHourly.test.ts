// An hourly reading that has outlived its hour (hourlyReadingOutlived).
// 22-oct 19:47, Castrelo: Ribadavia's 18:00 value (17.3 kt, 107 min old, preferred at 1.7 km)
// held NAVEG 9 kt while every fresh station read 0.6-5.4 kt.
import { describe, it, expect } from 'vitest';
import { scoreAllSpots, hourlyReadingOutlived } from './spotScoringEngine';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import { EMBALSE_SPOTS } from '../config/spots';

const castrelo = EMBALSE_SPOTS.find((s) => s.id === 'castrelo')!;
const [lon, lat] = castrelo.center;
const msFromKt = (kt: number) => kt / 1.94384;

function station(id: string, dLat: number, dLon: number, source: NormalizedStation['source']): NormalizedStation {
  return { id, name: id, lat: lat + dLat, lon: lon + dLon, altitude: 100, source, tempOnly: false };
}

function reading(id: string, kt: number, dir: number, ageMin: number): NormalizedReading {
  return {
    stationId: id, timestamp: new Date(Date.now() - ageMin * 60_000),
    windSpeed: msFromKt(kt), windGust: null, windDirection: dir,
    temperature: 14, humidity: 80, precipitation: null, solarRadiation: null, pressure: 1012, dewPoint: 10,
  };
}

/** Ribadavia at its real position, preferred for Castrelo. */
const RIB = { id: 'aemet_1701X', st: { id: 'aemet_1701X', name: 'RIBADAVIA', lat: 42.30, lon: -8.1292, altitude: 100, source: 'aemet', tempOnly: false } as NormalizedStation };

function score(entries: { st: NormalizedStation; rd: NormalizedReading }[]) {
  return scoreAllSpots([castrelo], entries.map((e) => e.st), new Map(entries.map((e) => [e.st.id, e.rd])), []).get('castrelo')!;
}

describe('hourlyReadingOutlived', () => {
  it('drops an old hourly reading three times above every fresh witness', () => {
    expect(hourlyReadingOutlived('aemet_1701X', 107, 17.3, [5.4, 0.6, 3.4])).toBe(true);
    expect(hourlyReadingOutlived('ipma_1200545', 120, 12, [2, 1])).toBe(true);
  });

  it('counts calm witnesses (a fresh 0.6 kt is a measurement of now)', () => {
    expect(hourlyReadingOutlived('aemet_1701X', 100, 4, [0.2, 0.6])).toBe(true);
  });

  it('keeps it while it is within its hour, or not three times every fresh witness', () => {
    expect(hourlyReadingOutlived('aemet_1701X', 85, 17.3, [0.6, 3.4])).toBe(false);
    expect(hourlyReadingOutlived('aemet_1701X', 107, 13.6, [5.2, 1.8])).toBe(false);
  });

  it('keeps it with fewer than two fresh witnesses', () => {
    expect(hourlyReadingOutlived('aemet_1701X', 107, 17.3, [])).toBe(false);
    expect(hourlyReadingOutlived('aemet_1701X', 107, 17.3, [0.6])).toBe(false);
  });

  it('only applies to hourly networks', () => {
    expect(hourlyReadingOutlived('mg_10157', 107, 17.3, [0.6, 3.4])).toBe(false);
    expect(hourlyReadingOutlived('wu_IOURENSE1', 107, 17.3, [0.6, 3.4])).toBe(false);
  });
});

describe('Castrelo: an old Ribadavia reading against fresh stations', () => {
  it('22-oct 19:47: 17.3 kt from 107 min ago no longer holds NAVEG against fresh calm', () => {
    const s = score([
      { st: RIB.st, rd: reading(RIB.id, 17.3, 221, 107) },
      { st: station('mg_prado', 0.03, 0.02, 'meteogalicia'), rd: reading('mg_prado', 0.6, 200, 8) },
      { st: station('mg_leiro', 0.06, -0.04, 'meteogalicia'), rd: reading('mg_leiro', 3.4, 190, 9) },
      { st: station('skyx_SKY100', 0.002, 0.002, 'skyx'), rd: reading('skyx_SKY100', 5.4, 200, 4) },
    ]);
    expect(['sailing', 'good', 'strong']).not.toContain(s.verdict);
    expect(s.wind!.avgSpeedKt).toBeLessThan(6);
    expect(s.wind!.contributions.some((c) => c.name === 'RIBADAVIA')).toBe(false);
  });

  it('keeps it when it is the only data (night, or only AEMET reporting)', () => {
    const s = score([{ st: RIB.st, rd: reading(RIB.id, 12, 221, 107) }]);
    expect(s.wind).not.toBeNull();
    expect(s.wind!.contributions.some((c) => c.name === 'RIBADAVIA')).toBe(true);
  });

  it('keeps it when the other stations are not fresh either', () => {
    const s = score([
      { st: RIB.st, rd: reading(RIB.id, 12, 221, 107) },
      { st: station('mc_a', 0.03, 0.02, 'meteoclimatic'), rd: reading('mc_a', 1, 200, 35) },
      { st: station('mc_b', 0.06, -0.04, 'meteoclimatic'), rd: reading('mc_b', 1.5, 190, 40) },
    ]);
    expect(s.wind!.contributions.some((c) => c.name === 'RIBADAVIA')).toBe(true);
  });

  it('keeps it when fresh stations still see a fair part of it (they under-read at Castrelo)', () => {
    const s = score([
      { st: RIB.st, rd: reading(RIB.id, 13.6, 221, 118) },
      { st: station('skyx_SKY100', 0.002, 0.002, 'skyx'), rd: reading('skyx_SKY100', 5.2, 210, 5) },
      { st: station('mg_prado', 0.03, 0.02, 'meteogalicia'), rd: reading('mg_prado', 1.8, 90, 8) },
    ]);
    expect(s.wind!.contributions.some((c) => c.name === 'RIBADAVIA')).toBe(true);
  });
});
