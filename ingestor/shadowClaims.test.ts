import { describe, it, expect, vi } from 'vitest';

vi.mock('./db.js', () => ({
  getPool: () => { throw new Error('no database in tests'); },
  stationAltitudeSql: async () => 's.altitude',
  sourceLabel: () => 'meteogalicia',
  hasColumn: async () => false,
}));
vi.mock('./forecastFetcher.js', () => ({ getForecast: async () => [] }));

import { buildSectorClaims, runShadowClaims, __resetShadowClaimsForTests } from './shadowClaims';
import { SECTORS } from '../src/config/sectors';
import { getSpotsForSector, isBeachSpot } from '../src/config/spots';
import type { NormalizedReading, NormalizedStation } from '../src/types/station';
import type { HourlyForecast } from '../src/types/forecast';
import type { SpotScore } from '../src/services/spotScoringEngine';

const NOW = new Date('2026-11-11T12:00:00Z');
const rias = SECTORS.find((s) => s.id === 'rias')!;
const embalse = SECTORS.find((s) => s.id === 'embalse')!;

function reading(id: string, over: Partial<NormalizedReading> = {}): NormalizedReading {
  return {
    stationId: id, timestamp: new Date(NOW.getTime() - 5 * 60_000),
    windSpeed: 3, windGust: 5, windDirection: 220, temperature: 15, humidity: 80, precipitation: 0,
    solarRadiation: 100, pressure: 1015, dewPoint: 11, ...over,
  };
}

function hour(offsetH: number, over: Partial<HourlyForecast> = {}): HourlyForecast {
  return {
    time: new Date(NOW.getTime() + offsetH * 3600_000), temperature: 14, humidity: 80, windSpeed: 3,
    windDirection: 220, windGusts: 6, precipitation: 0, precipProbability: 10, cloudCover: 40,
    pressure: 1015, solarRadiation: 100, cape: 0, ...over,
  } as HourlyForecast;
}

const stations: NormalizedStation[] = [
  { id: 'mg_a', source: 'meteogalicia', name: 'A', lat: 42.3, lon: -8.7, altitude: 10 },
  { id: 'mg_b', source: 'meteogalicia', name: 'B', lat: 42.25, lon: -8.4, altitude: 50 },
];
const readings = new Map(stations.map((s) => [s.id, reading(s.id)]));

describe('buildSectorClaims', () => {
  it('coastal sector: every solution answers, rain per spot, and never throws without buoys', () => {
    const out = buildSectorClaims({
      sector: rias, stations, readings, history: new Map(), buoys: [],
      forecast: [hour(0), hour(1), hour(2)], engineScores: new Map(), now: NOW,
    });
    const types = new Set(out.claims.map((c) => c.type));
    for (const t of ['shadow-fog-physics', 'shadow-cross-sea', 'shadow-sea-breeze', 'shadow-pressure', 'shadow-frost', 'shadow-rain-now']) {
      expect(types.has(t), t).toBe(true);
    }
    expect(out.skipped).toEqual([]);
    const rain = out.claims.filter((c) => c.type === 'shadow-rain-now');
    expect(rain.map((c) => c.subject).sort()).toEqual(getSpotsForSector('rias').map((s) => s.id).sort());
    expect(rain.every((c) => c.params.radar === false)).toBe(true);
    const fog = out.claims.find((c) => c.type === 'shadow-fog-physics')!;
    expect(fog.state).toBe('none');
    expect(fog.params.cameras).toBe(false);
    expect(fog.params.freshBuoys).toBe(0);
  });

  it('inland sector: no marine solutions and no beach day', () => {
    const out = buildSectorClaims({
      sector: embalse, stations, readings, history: new Map(), buoys: [],
      forecast: [hour(0)], engineScores: new Map(), now: NOW,
    });
    const types = new Set(out.claims.map((c) => c.type));
    expect(types.has('shadow-fog-physics')).toBe(false);
    expect(types.has('shadow-cross-sea')).toBe(false);
    expect(types.has('shadow-sea-breeze')).toBe(false);
    expect(types.has('shadow-beach-day')).toBe(false);
    expect(types.has('shadow-pressure')).toBe(true);
    expect(types.has('shadow-frost')).toBe(true);
  });

  it('without a forecast frost is left out and said, rain still answers from stations', () => {
    const out = buildSectorClaims({
      sector: embalse, stations, readings, history: new Map(), buoys: [],
      forecast: [], engineScores: null, now: NOW,
    });
    expect(out.claims.some((c) => c.type === 'shadow-frost')).toBe(false);
    expect(out.skipped).toContain('prevision embalse');
    expect(out.claims.some((c) => c.type === 'shadow-rain-now')).toBe(true);
  });

  it('beach day needs the engine scores; with them it answers for beach spots only', () => {
    const none = buildSectorClaims({
      sector: rias, stations, readings, history: new Map(), buoys: [], forecast: [hour(0)], engineScores: null, now: NOW,
    });
    expect(none.claims.some((c) => c.type === 'shadow-beach-day')).toBe(false);
    expect(none.skipped.some((s) => s.startsWith('dia de playa'))).toBe(true);

    const beach = getSpotsForSector('rias').find((s) => isBeachSpot(s.id))!;
    const other = getSpotsForSector('rias').find((s) => !isBeachSpot(s.id))!;
    const score = { effectiveWindKt: 6, gustKt: 9, airTemp: 26, waterTemp: 18 } as unknown as SpotScore;
    const scores = new Map<string, SpotScore>([[beach.id, score], [other.id, score]]);
    const out = buildSectorClaims({
      sector: rias, stations, readings, history: new Map(), buoys: [],
      forecast: [hour(0, { cloudCover: 5 })], engineScores: scores, now: NOW,
    });
    const days = out.claims.filter((c) => c.type === 'shadow-beach-day');
    expect(days.map((c) => c.subject)).toEqual([beach.id]);
    expect(days[0].params).toMatchObject({ windKt: 6, airTempC: 26, waterTempC: 18, cloudCoverPct: 5, foggy: null });
    expect(['great', 'ok', 'poor', 'unknown']).toContain(days[0].state);
  });

  it('a falling network pressure becomes a state other than none', () => {
    const history = new Map<string, NormalizedReading[]>();
    const now = Date.now();
    const cur = new Map<string, NormalizedReading>();
    for (const s of stations) {
      const r = reading(s.id, { timestamp: new Date(now - 60_000), pressure: 1000 });
      cur.set(s.id, r);
      history.set(s.id, [reading(s.id, { timestamp: new Date(now - 2.5 * 3600_000), pressure: 1010 }), r]);
    }
    const out = buildSectorClaims({
      sector: embalse, stations, readings: cur, history, buoys: [], forecast: [hour(0)], engineScores: null, now: new Date(now),
    });
    const p = out.claims.find((c) => c.type === 'shadow-pressure')!;
    expect(p.state).not.toBe('none');
    expect(p.params.totalAnalyzed).toBe(2);
    expect(p.params.medianDelta).toBe(-10);
  });
});

describe('runShadowClaims', () => {
  it('never throws, also without a database', async () => {
    __resetShadowClaimsForTests();
    await expect(runShadowClaims()).resolves.toBeUndefined();
  });
});
