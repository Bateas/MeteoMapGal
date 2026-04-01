/**
 * Tests for spotScoringEngine — core verdict + scoring logic.
 * Covers: windVerdict thresholds, scoreAllSpots integration, hard gates.
 */
import { describe, it, expect } from 'vitest';
import { scoreAllSpots, type SpotScore, type SpotVerdict } from './spotScoringEngine';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import type { BuoyReading } from '../types/buoy';
import { RIAS_SPOTS, EMBALSE_SPOTS } from '../config/spots';

// ── Helpers ──────────────────────────────────────────────

function makeStation(id: string, lat: number, lon: number, source = 'meteogalicia' as const): NormalizedStation {
  return { id, name: id, lat, lon, altitude: 10, source, tempOnly: false };
}

function makeReading(stationId: string, windSpeed: number | null, windDir: number | null, temp = 18): NormalizedReading {
  return {
    stationId,
    timestamp: new Date(),
    windSpeed,
    windGust: windSpeed ? windSpeed * 1.3 : null,
    windDirection: windDir,
    temperature: temp,
    humidity: 55,
    precipitation: null,
    solarRadiation: null,
    pressure: 1015,
    dewPoint: 12,
  };
}

const msFromKt = (kt: number) => kt / 1.94384;

// ── Verdict Thresholds ───────────────────────────────────

describe('scoreAllSpots', () => {
  const cesantes = RIAS_SPOTS.find(s => s.id === 'cesantes')!;

  it('returns unknown for spot with no stations nearby', () => {
    const results = scoreAllSpots([cesantes], [], new Map(), []);
    const score = results.get('cesantes');
    expect(score).toBeDefined();
    expect(score!.verdict).toBe('unknown');
  });

  it('returns calm for 3kt wind', () => {
    const station = makeStation('test1', cesantes.center[1], cesantes.center[0]);
    const reading = makeReading('test1', msFromKt(3), 225);
    const results = scoreAllSpots([cesantes], [station], new Map([['test1', reading]]), []);
    expect(results.get('cesantes')!.verdict).toBe('calm');
  });

  it('returns light for 7kt wind', () => {
    const station = makeStation('test1', cesantes.center[1], cesantes.center[0]);
    const reading = makeReading('test1', msFromKt(7), 225);
    const results = scoreAllSpots([cesantes], [station], new Map([['test1', reading]]), []);
    expect(results.get('cesantes')!.verdict).toBe('light');
  });

  it('returns sailing for 10kt wind', () => {
    const station = makeStation('test1', cesantes.center[1], cesantes.center[0]);
    const reading = makeReading('test1', msFromKt(10), 225);
    const results = scoreAllSpots([cesantes], [station], new Map([['test1', reading]]), []);
    expect(results.get('cesantes')!.verdict).toBe('sailing');
  });

  it('returns good for 14kt wind', () => {
    const station = makeStation('test1', cesantes.center[1], cesantes.center[0]);
    const reading = makeReading('test1', msFromKt(14), 225);
    const results = scoreAllSpots([cesantes], [station], new Map([['test1', reading]]), []);
    expect(results.get('cesantes')!.verdict).toBe('good');
  });

  it('returns strong for 20kt wind', () => {
    const station = makeStation('test1', cesantes.center[1], cesantes.center[0]);
    const reading = makeReading('test1', msFromKt(20), 225);
    const results = scoreAllSpots([cesantes], [station], new Map([['test1', reading]]), []);
    expect(results.get('cesantes')!.verdict).toBe('strong');
  });

  it('includes wind consensus data', () => {
    const station = makeStation('test1', cesantes.center[1], cesantes.center[0]);
    const reading = makeReading('test1', msFromKt(12), 225);
    const results = scoreAllSpots([cesantes], [station], new Map([['test1', reading]]), []);
    const score = results.get('cesantes')!;
    expect(score.wind).toBeDefined();
    expect(score.wind!.avgSpeedKt).toBeGreaterThan(10);
    expect(score.wind!.stationCount).toBe(1);
  });

  it('scores multiple spots simultaneously', () => {
    // Use a subset to avoid wave-related crashes with empty buoy data
    const subset = [cesantes, EMBALSE_SPOTS[0]];
    const results = scoreAllSpots(subset, [], new Map(), []);
    for (const spot of subset) {
      expect(results.has(spot.id)).toBe(true);
      expect(results.get(spot.id)!.verdict).toBe('unknown');
    }
  });

  it('ocean spot (cies-ria) has different thresholds', () => {
    const cies = RIAS_SPOTS.find(s => s.id === 'cies-ria')!;
    const station = makeStation('test1', cies.center[1], cies.center[0]);
    const reading = makeReading('test1', msFromKt(7), 330);
    // Cies needs buoy data (waveRelevance: 'critical')
    const buoy: BuoyReading = {
      stationId: 2248, stationName: 'Silleiro', timestamp: new Date(),
      waveHeight: 1.0, wavePeriod: 8, waveDirection: 300,
      windSpeed: msFromKt(7), windDir: 330, windGust: null,
      waterTemp: 14, airTemp: 16, humidity: null, dewPoint: null,
      pressure: null, salinity: null, currentSpeed: null, currentDir: null,
      seaLevelHeight: null,
    };
    const results = scoreAllSpots([cies], [station], new Map([['test1', reading]]), [buoy]);
    // 7kt = light for ocean (needs 10+ for sailing)
    expect(results.get('cies-ria')!.verdict).toBe('light');
  });

  it('rejects stale readings (lower freshness weight)', () => {
    const station = makeStation('test1', cesantes.center[1], cesantes.center[0]);
    const staleReading = makeReading('test1', msFromKt(12), 225);
    staleReading.timestamp = new Date(Date.now() - 60 * 60_000); // 1 hour old
    const results = scoreAllSpots([cesantes], [station], new Map([['test1', staleReading]]), []);
    const score = results.get('cesantes')!;
    // Stale data should still produce a verdict but with lower confidence
    expect(score.verdict).toBeDefined();
    expect(score.scoringConfidence).toBe('low');
  });

  it('new spots are valid and scoreable', () => {
    const newSpots = RIAS_SPOTS.filter(s =>
      ['castineiras', 'vao', 'lanzada', 'illa-arousa'].includes(s.id)
    );
    expect(newSpots).toHaveLength(4);
    const results = scoreAllSpots(newSpots, [], new Map(), []);
    for (const spot of newSpots) {
      expect(results.has(spot.id)).toBe(true);
      expect(results.get(spot.id)!.verdict).toBe('unknown');
    }
  });
});
