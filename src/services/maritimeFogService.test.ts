/**
 * Tests for maritimeFogService — Rías advection-fog detector.
 *
 * Audit S136+3+5: this 751-line service (largest detector, high user value
 * — fog is critical for Rías navigation) was UNTESTED. Tests focus on the
 * two pure exported functions that gate false positives:
 *   - detectNorthWindConsensus: "is there real N wind that kills fog?"
 *   - detectFogBySolarSignature: "which stations have fog overhead (HR high
 *     + solar blocked + air saturated)?"
 *
 * Timezone note (CLAUDE.md gotcha): detectFogBySolarSignature gates on
 * `new Date().getHours()` in [9,19]. Tests pin the clock to 14:00 UTC
 * (= 16:00 CEST) so the hour is in-range under both CI (UTC) and local (CEST).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectNorthWindConsensus, detectFogBySolarSignature } from './maritimeFogService';
import type { NormalizedReading } from '../types/station';

function reading(over: Partial<NormalizedReading>): NormalizedReading {
  return {
    stationId: 's',
    timestamp: new Date(),
    windSpeed: null,
    windGust: null,
    windDirection: null,
    temperature: null,
    humidity: null,
    precipitation: null,
    solarRadiation: null,
    pressure: null,
    dewPoint: null,
    ...over,
  };
}

// kt → m/s helper (service works in m/s)
const kt = (k: number) => k / 1.94384;

describe('detectNorthWindConsensus', () => {
  it('returns false with fewer than 4 wind-reporting stations', () => {
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: kt(15), windDirection: 0 })],
      ['b', reading({ windSpeed: kt(15), windDirection: 10 })],
      ['c', reading({ windSpeed: kt(15), windDirection: 350 })],
    ]);
    expect(detectNorthWindConsensus(m)).toBe(false);
  });

  it('returns false when <60% of stations are northerly', () => {
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: kt(12), windDirection: 10 })],   // N
      ['b', reading({ windSpeed: kt(12), windDirection: 200 })],  // SW
      ['c', reading({ windSpeed: kt(12), windDirection: 210 })],  // SW
      ['d', reading({ windSpeed: kt(12), windDirection: 220 })],  // SW
    ]);
    expect(detectNorthWindConsensus(m)).toBe(false);
  });

  it('returns true when ≥60% northerly with a strong gust (≥10kt)', () => {
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: kt(6), windDirection: 10, windGust: kt(12) })],   // N, gust 12kt
      ['b', reading({ windSpeed: kt(6), windDirection: 350 })],
      ['c', reading({ windSpeed: kt(6), windDirection: 30 })],
      ['d', reading({ windSpeed: kt(6), windDirection: 200 })],
    ]);
    expect(detectNorthWindConsensus(m)).toBe(true);
  });

  it('returns false when northerly but all winds are weak/calm', () => {
    // 4 northerly stations, all ~1.5kt — below MIN_NORTH_SPEED, no strong gust
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: kt(1.5), windDirection: 0, windGust: kt(2) })],
      ['b', reading({ windSpeed: kt(1.5), windDirection: 10, windGust: kt(2) })],
      ['c', reading({ windSpeed: kt(1.5), windDirection: 350, windGust: kt(2) })],
      ['d', reading({ windSpeed: kt(1.5), windDirection: 20, windGust: kt(2) })],
    ]);
    expect(detectNorthWindConsensus(m)).toBe(false);
  });

  it('returns true when northerly with sustained median speed ≥5kt', () => {
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: kt(6), windDirection: 0, windGust: kt(7) })],
      ['b', reading({ windSpeed: kt(6), windDirection: 10, windGust: kt(7) })],
      ['c', reading({ windSpeed: kt(6), windDirection: 350, windGust: kt(7) })],
      ['d', reading({ windSpeed: kt(6), windDirection: 20, windGust: kt(7) })],
    ]);
    expect(detectNorthWindConsensus(m)).toBe(true);
  });

  it('ignores stations below 1 m/s when counting reporters', () => {
    // Only 3 stations report ≥1 m/s → below MIN_STATIONS even though map has 5
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: kt(15), windDirection: 0 })],
      ['b', reading({ windSpeed: kt(15), windDirection: 10 })],
      ['c', reading({ windSpeed: kt(15), windDirection: 350 })],
      ['d', reading({ windSpeed: 0.5, windDirection: 20 })],  // <1 m/s ignored
      ['e', reading({ windSpeed: 0.3, windDirection: 30 })],  // <1 m/s ignored
    ]);
    expect(detectNorthWindConsensus(m)).toBe(false);
  });

  it('treats NE (up to 80°) as northerly for the Galician nortada', () => {
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: kt(7), windDirection: 70, windGust: kt(11) })], // NE, strong gust
      ['b', reading({ windSpeed: kt(7), windDirection: 60 })],
      ['c', reading({ windSpeed: kt(7), windDirection: 50 })],
      ['d', reading({ windSpeed: kt(7), windDirection: 40 })],
    ]);
    expect(detectNorthWindConsensus(m)).toBe(true);
  });
});

describe('detectFogBySolarSignature', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 14:00 UTC = 16:00 CEST → in the [9,19] daylight gate under both TZs
    vi.setSystemTime(new Date('2026-05-28T14:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const interiorSunStation = { id: 'interior', lat: 42.3, lon: -8.1 }; // lon > -8.5 = interior
  const coastStation = { id: 'coast', lat: 42.2, lon: -8.9 };

  it('returns [] at night (outside 9-19h gate)', () => {
    vi.setSystemTime(new Date('2026-05-28T02:00:00Z')); // 04:00 CEST — night
    const readings = new Map([
      ['interior', reading({ solarRadiation: 400 })],
      ['coast', reading({ humidity: 95, solarRadiation: 50, temperature: 14, dewPoint: 13.5 })],
    ]);
    expect(detectFogBySolarSignature(readings, [interiorSunStation, coastStation])).toEqual([]);
  });

  it('returns [] when no interior station shows sun (generally overcast)', () => {
    const readings = new Map([
      ['interior', reading({ solarRadiation: 100 })], // no interior sun
      ['coast', reading({ humidity: 95, solarRadiation: 50, temperature: 14, dewPoint: 13.5 })],
    ]);
    expect(detectFogBySolarSignature(readings, [interiorSunStation, coastStation])).toEqual([]);
  });

  it('detects a coastal fog station when interior is sunny + air saturated', () => {
    const readings = new Map([
      ['interior', reading({ solarRadiation: 500 })],
      ['coast', reading({ humidity: 95, solarRadiation: 40, temperature: 14, dewPoint: 13.2 })], // spread 0.8 <2
    ]);
    const result = detectFogBySolarSignature(readings, [interiorSunStation, coastStation]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('coast');
  });

  it('rejects a station whose air is NOT saturated (spread ≥2°C = storm clouds, not fog)', () => {
    const readings = new Map([
      ['interior', reading({ solarRadiation: 500 })],
      ['coast', reading({ humidity: 95, solarRadiation: 40, temperature: 16, dewPoint: 13 })], // spread 3 ≥2
    ]);
    expect(detectFogBySolarSignature(readings, [interiorSunStation, coastStation])).toEqual([]);
  });

  it('invalidates regionally when any station reports active rain', () => {
    const readings = new Map([
      ['interior', reading({ solarRadiation: 500, precipitation: 0.5 })], // rain → storm, not fog
      ['coast', reading({ humidity: 95, solarRadiation: 40, temperature: 14, dewPoint: 13.5 })],
    ]);
    expect(detectFogBySolarSignature(readings, [interiorSunStation, coastStation])).toEqual([]);
  });

  it('rejects stations below 90% humidity', () => {
    const readings = new Map([
      ['interior', reading({ solarRadiation: 500 })],
      ['coast', reading({ humidity: 85, solarRadiation: 40, temperature: 14, dewPoint: 13.5 })], // HR<90
    ]);
    expect(detectFogBySolarSignature(readings, [interiorSunStation, coastStation])).toEqual([]);
  });
});
