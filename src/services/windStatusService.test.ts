/**
 * Tests for windStatusService — real-time wind consensus + trend + zones.
 *
 * `computeWindConsensus` is pure (Map in → consensus out).
 * `computeWindStatus` uses the real wall clock internally for the trend /
 * duration windows, so history readings are built relative to Date.now().
 */
import { describe, it, expect } from 'vitest';
import { computeWindConsensus, computeWindStatus } from './windStatusService';
import type { NormalizedReading, NormalizedStation } from '../types/station';
import type { MicroZone, MicroZoneId } from '../types/thermal';

function reading(over: Partial<NormalizedReading> = {}, ageMin = 0): NormalizedReading {
  return {
    stationId: 's',
    timestamp: new Date(Date.now() - ageMin * 60_000),
    windSpeed: 5, windGust: null, windDirection: 270,
    temperature: 20, humidity: 60, precipitation: 0,
    solarRadiation: null, pressure: null, dewPoint: null,
    ...over,
  };
}

function station(id: string, lat: number, lon: number): NormalizedStation {
  return { id, source: 'meteogalicia', name: id, lat, lon, altitude: 50 };
}

function zone(id: MicroZoneId, name: string): MicroZone {
  return {
    id, name, stationPatterns: [], center: { lat: 42.3, lon: -8.1 },
    polygon: [], color: '#fff', avgAltitude: 100,
  };
}

describe('computeWindConsensus', () => {
  it('builds a consensus when ≥2 stations agree on direction', () => {
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windDirection: 268, windSpeed: 5 })],
      ['b', reading({ windDirection: 272, windSpeed: 6 })],
      ['c', reading({ windDirection: 275, windSpeed: 4 })],
    ]);
    const c = computeWindConsensus(m);
    expect(c).not.toBeNull();
    expect(c!.stationCount).toBe(3);
    expect(c!.dominantDir).toBe('W');
    expect(c!.avgSpeedKt).toBeGreaterThan(2);
  });

  it('returns null with fewer than 2 wind stations', () => {
    const m = new Map<string, NormalizedReading>([['a', reading({ windSpeed: 5 })]]);
    expect(computeWindConsensus(m)).toBeNull();
  });

  it('returns null when all stations are calm (<2 kt)', () => {
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: 0.3 })],
      ['b', reading({ windSpeed: 0.5 })],
    ]);
    expect(computeWindConsensus(m)).toBeNull();
  });

  it('ignores readings with null wind speed or direction', () => {
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: null })],
      ['b', reading({ windDirection: null })],
      ['c', reading({ windSpeed: 5, windDirection: 270 })],
    ]);
    expect(computeWindConsensus(m)).toBeNull(); // only 1 valid → <2
  });

  it('picks the largest direction group when directions split', () => {
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windDirection: 270, windSpeed: 5 })],
      ['b', reading({ windDirection: 272, windSpeed: 5 })],
      ['c', reading({ windDirection: 268, windSpeed: 5 })],
      ['d', reading({ windDirection: 90, windSpeed: 5 })], // lone E
    ]);
    const c = computeWindConsensus(m);
    expect(c!.dominantDir).toBe('W');
    expect(c!.stationCount).toBe(3);
  });
});

describe('computeWindStatus — integration', () => {
  const stations = [station('a', 42.30, -8.10), station('b', 42.32, -8.12)];
  const zones = [zone('embalse', 'Embalse')];
  const stationToZone = new Map<string, MicroZoneId>([['a', 'embalse'], ['b', 'embalse']]);

  function current(dir: number, speed: number) {
    return new Map<string, NormalizedReading>([
      ['a', reading({ windDirection: dir, windSpeed: speed })],
      ['b', reading({ windDirection: dir + 3, windSpeed: speed })],
    ]);
  }

  it('detects a rising trend when recent wind > earlier wind', () => {
    const hist = new Map<string, NormalizedReading[]>([
      ['a', [
        reading({ windSpeed: 3 }, 35), reading({ windSpeed: 3 }, 25), // previous window
        reading({ windSpeed: 9 }, 15), reading({ windSpeed: 9 }, 5),  // recent window
      ]],
      ['b', [
        reading({ windSpeed: 3 }, 33), reading({ windSpeed: 3 }, 27),
        reading({ windSpeed: 9 }, 13), reading({ windSpeed: 9 }, 7),
      ]],
    ]);
    const status = computeWindStatus(current(270, 9), hist, stations, stationToZone, zones);
    expect(status.trend).not.toBeNull();
    expect(status.trend!.direction).toBe('rising');
    expect(status.trend!.rateKtPerHour).toBeGreaterThan(0);
  });

  it('detects a falling trend when recent wind < earlier wind', () => {
    const hist = new Map<string, NormalizedReading[]>([
      ['a', [
        reading({ windSpeed: 10 }, 35), reading({ windSpeed: 10 }, 25),
        reading({ windSpeed: 2 }, 15), reading({ windSpeed: 2 }, 5),
      ]],
      ['b', [
        reading({ windSpeed: 10 }, 33), reading({ windSpeed: 10 }, 27),
        reading({ windSpeed: 2 }, 13), reading({ windSpeed: 2 }, 7),
      ]],
    ]);
    const status = computeWindStatus(current(270, 2), hist, stations, stationToZone, zones);
    expect(status.trend!.direction).toBe('falling');
    expect(status.trend!.rateKtPerHour).toBeLessThan(0);
  });

  it('returns null trend with insufficient history', () => {
    const hist = new Map<string, NormalizedReading[]>([['a', [reading({}, 5)]]]);
    const status = computeWindStatus(current(270, 5), hist, stations, stationToZone, zones);
    expect(status.trend).toBeNull();
  });

  it('marks a zone as agreeing when its direction matches the consensus', () => {
    const status = computeWindStatus(current(270, 5), new Map(), stations, stationToZone, zones);
    expect(status.consensus!.dominantDir).toBe('W');
    const z = status.zoneSummaries.find((s) => s.zoneId === 'embalse');
    expect(z).toBeDefined();
    expect(z!.dominantDir).toBe('W');
    expect(z!.agrees).toBe(true);
    expect(z!.stationCount).toBe(2);
  });

  it('reports an empty zone summary when no station reports wind there', () => {
    const otherZone = new Map<string, MicroZoneId>([['a', 'ourense'], ['b', 'ourense']]);
    const status = computeWindStatus(current(270, 5), new Map(), stations, otherZone, zones);
    const z = status.zoneSummaries.find((s) => s.zoneId === 'embalse');
    expect(z!.dominantDir).toBeNull();
    expect(z!.stationCount).toBe(0);
    expect(z!.agrees).toBe(false);
  });

  it('no consensus → null duration and stableHours', () => {
    const calm = new Map<string, NormalizedReading>([['a', reading({ windSpeed: 0.2 })]]);
    const status = computeWindStatus(calm, new Map(), stations, stationToZone, zones);
    expect(status.consensus).toBeNull();
    expect(status.consensusDurationMin).toBeNull();
    expect(status.stableHours).toBeNull();
  });
});
