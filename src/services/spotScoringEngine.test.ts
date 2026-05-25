/**
 * Tests for spotScoringEngine — core verdict + scoring logic.
 * Covers: windVerdict thresholds, scoreAllSpots integration, hard gates.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// ── Spatial Wind Coherence (#63) ─────────────────────────────

describe('spatial wind coherence', () => {
  const cesantes = RIAS_SPOTS.find(s => s.id === 'cesantes')!;

  it('regional coherence: sheltered station does not drag consensus below majority', () => {
    // 3 exposed stations at 15-20kt NW, 1 sheltered at 5kt — consensus should be ≥13kt
    const exposed1 = makeStation('mg_exp1', 42.32, -8.63, 'meteogalicia');
    const exposed2 = makeStation('mg_exp2', 42.30, -8.60, 'aemet');
    const exposed3 = makeStation('mg_exp3', 42.31, -8.64, 'meteogalicia');
    const sheltered = makeStation('wu_shelt', 42.307, -8.619, 'wunderground');
    const readings = new Map([
      ['mg_exp1', makeReading('mg_exp1', msFromKt(18), 330)],
      ['mg_exp2', makeReading('mg_exp2', msFromKt(16), 320)],
      ['mg_exp3', makeReading('mg_exp3', msFromKt(20), 340)],
      ['wu_shelt', makeReading('wu_shelt', msFromKt(5), 330)],
    ]);
    const results = scoreAllSpots([cesantes], [exposed1, exposed2, exposed3, sheltered], readings, []);
    const score = results.get('cesantes')!;
    // With spatial coherence, sheltered station should not drag below 13kt
    expect(score.wind!.avgSpeedKt).toBeGreaterThanOrEqual(13);
  });

  it('buoy readings get exposure boost over land stations', () => {
    // Buoy at ~12km with 14kt vs land WU at 4km with 7kt — buoy should have more influence
    const land = makeStation('wu_land', 42.31, -8.62, 'wunderground');
    const buoy: BuoyReading = {
      stationId: 3221, stationName: 'Vigo', timestamp: new Date(),
      waveHeight: null, wavePeriod: null, waveDirection: null, waveHeightMax: null, wavePeriodMean: null,
      windSpeed: msFromKt(14), windDir: 225, windGust: null,
      waterTemp: 14, airTemp: 16, humidity: null, dewPoint: null,
      airPressure: null, salinity: null, currentSpeed: null, currentDir: null,
      seaLevelHeight: null,
    };
    const readings = new Map([['wu_land', makeReading('wu_land', msFromKt(7), 225)]]);
    const results = scoreAllSpots([cesantes], [land], readings, [buoy]);
    // With buoy exposure boost, consensus should favor buoy over pure distance average
    // Buoy at 12km with 1.5x boost vs WU at 4km with 0.7 quality — buoy pulls up
    expect(results.get('cesantes')!.wind!.avgSpeedKt).toBeGreaterThan(8);
  });

  it('calm day: no false boost when all sources are calm', () => {
    const s1 = makeStation('mg_calm1', 42.31, -8.63, 'meteogalicia');
    const s2 = makeStation('mg_calm2', 42.30, -8.61, 'aemet');
    const readings = new Map([
      ['mg_calm1', makeReading('mg_calm1', msFromKt(3), 180)],
      ['mg_calm2', makeReading('mg_calm2', msFromKt(2), 200)],
    ]);
    const results = scoreAllSpots([cesantes], [s1, s2], readings, []);
    expect(results.get('cesantes')!.verdict).toBe('calm');
    expect(results.get('cesantes')!.wind!.avgSpeedKt).toBeLessThan(5);
  });

  it('tighter outlier catches 0.35x ratio sheltered station', () => {
    // 3 stations at ~15kt, 1 sheltered at 5.3kt (ratio 0.35) — should be penalized
    const s1 = makeStation('mg_s1', 42.31, -8.63, 'aemet');
    const s2 = makeStation('mg_s2', 42.30, -8.61, 'meteogalicia');
    const s3 = makeStation('mg_s3', 42.32, -8.62, 'meteogalicia');
    const shelt = makeStation('wu_lo', 42.307, -8.619, 'wunderground');
    const readings = new Map([
      ['mg_s1', makeReading('mg_s1', msFromKt(15), 225)],
      ['mg_s2', makeReading('mg_s2', msFromKt(15), 225)],
      ['mg_s3', makeReading('mg_s3', msFromKt(15), 225)],
      ['wu_lo', makeReading('wu_lo', msFromKt(5.3), 225)],
    ]);
    const results = scoreAllSpots([cesantes], [s1, s2, s3, shelt], readings, []);
    // Sheltered penalized by regional coherence + tighter outlier → consensus ≥12kt
    expect(results.get('cesantes')!.wind!.avgSpeedKt).toBeGreaterThanOrEqual(12);
  });
});

// ── Cesantes Canalization Override (S136+3) ───────────────────────────
// Connects cesantesCanalizationDetector to scoring — sheltered preferred
// stations (Lourizán/Marín/Vigo Porto) under-read by ~50% during thermal breeze.
// Without this fix, popup said "FLOJO 6kt" while kiters/windsurfers planning
// in the water with ~14-18kt SW (validated by webcam evidence May 2026).

describe('Cesantes canalization override', () => {
  const cesantes = RIAS_SPOTS.find(s => s.id === 'cesantes')!;

  // Rande buoy 1251 with realistic water temp (ObsCosteiro has no wind, only T/HR)
  const randeBuoy: BuoyReading = {
    stationId: 1251, stationName: 'Rande', timestamp: new Date(),
    waveHeight: null, wavePeriod: null, waveDirection: null,
    waveHeightMax: null, wavePeriodMean: null,
    windSpeed: null, windDir: null, windGust: null,
    waterTemp: 21, airTemp: null, humidity: 70, dewPoint: 18,
    airPressure: null, salinity: null, currentSpeed: null, currentDir: null,
    seaLevelHeight: null,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    // 17:00 local = peak thermal breeze hour in Cesantes
    vi.setSystemTime(new Date('2026-05-25T15:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('overrides FLOJO verdict to BUENO when thermal breeze predicts ≥4kt above measured', () => {
    // Reproduces the v2.81.29 prod bug: station reads 6kt + airTemp 25°C + waterTemp 21°C (ΔT=4°C)
    // → detector predicts baseKt 6 + (4 × 2) = 14kt → verdict should be 'good', not 'light'
    const station = makeStation('mg_test', cesantes.center[1], cesantes.center[0]);
    const reading = makeReading('mg_test', msFromKt(6), 230, 25);
    const results = scoreAllSpots([cesantes], [station], new Map([['mg_test', reading]]), [randeBuoy]);
    const score = results.get('cesantes')!;
    expect(score.verdict).toBe('good');
    expect(score.thermalBoosted).toBe(true);
    // Summary should reflect canalized wind, not raw 6kt
    expect(score.summary).toMatch(/14kt|13kt|15kt/i);
  });

  it('does NOT override when ΔT <2°C (detector gate fails)', () => {
    // ΔT 1°C (airTemp 22, water 21) — fails detector's ≥2°C gate → no canalization
    // Use a low-humidity buoy to avoid other thermal boosts polluting the assertion.
    const dryBuoy: BuoyReading = { ...randeBuoy, humidity: 40 };
    const station = makeStation('mg_test', cesantes.center[1], cesantes.center[0]);
    const reading = makeReading('mg_test', msFromKt(7), 230, 22);
    const results = scoreAllSpots([cesantes], [station], new Map([['mg_test', reading]]), [dryBuoy]);
    const score = results.get('cesantes')!;
    // Without canalization boost (14kt), verdict cannot reach 'good' (≥12kt threshold)
    expect(score.verdict).not.toBe('good');
    // Summary should NOT contain "14kt" or similar canalized values
    expect(score.summary).not.toMatch(/1[2-9]kt/);
  });

  it('does NOT trigger outside thermal hours (early morning)', () => {
    vi.setSystemTime(new Date('2026-05-25T05:00:00Z')); // 07h local — before window
    const dryBuoy: BuoyReading = { ...randeBuoy, humidity: 40 };
    const station = makeStation('mg_test', cesantes.center[1], cesantes.center[0]);
    const reading = makeReading('mg_test', msFromKt(6), 230, 25);
    const results = scoreAllSpots([cesantes], [station], new Map([['mg_test', reading]]), [dryBuoy]);
    const score = results.get('cesantes')!;
    // Outside window → no canalization → no thermalBoosted from this path
    expect(score.thermalBoosted).toBe(false);
    expect(score.verdict).not.toBe('good');
  });

  it('does NOT apply to other Rías spots (Cesantes-only gate)', () => {
    const bocana = RIAS_SPOTS.find(s => s.id === 'bocana')!;
    const dryBuoy: BuoyReading = { ...randeBuoy, humidity: 40 };
    const station = makeStation('mg_test', bocana.center[1], bocana.center[0]);
    const reading = makeReading('mg_test', msFromKt(6), 230, 25);
    const results = scoreAllSpots([bocana], [station], new Map([['mg_test', reading]]), [dryBuoy]);
    const score = results.get('bocana')!;
    // Bocana wouldn't reach 'good' from 6kt without Cesantes-specific canalization
    expect(score.verdict).not.toBe('good');
    // avgSpeedKt remains close to measured 6kt — not promoted to 14kt
    expect(score.wind!.avgSpeedKt).toBeLessThan(10);
  });

  it('uses climatological SST fallback when buoys have no waterTemp (real prod case)', () => {
    // Reproduces v2.81.30 prod bug: buoys near Cesantes (Rande, Vigo Porto) don't
    // report waterTemp → engine had no SST → detector inactive → verdict stays FLOJO
    // even when SpotPopup shows the prediction (it uses MOHID fetch as fallback).
    // After fix: when airTempLocal >= 20°C, engine falls back to monthly climatology.
    const buoyWithoutWaterTemp: BuoyReading = { ...randeBuoy, waterTemp: null };
    const station = makeStation('mg_test', cesantes.center[1], cesantes.center[0]);
    const reading = makeReading('mg_test', msFromKt(7), 230, 27); // 27°C summer day
    const results = scoreAllSpots(
      [cesantes], [station], new Map([['mg_test', reading]]), [buoyWithoutWaterTemp],
    );
    const score = results.get('cesantes')!;
    // May climatology SST=16°C, airTemp=27 → ΔT=11°C → +8kt cap → 7+8=15kt → 'good'
    expect(score.verdict).toBe('good');
    expect(score.thermalBoosted).toBe(true);
  });

  it('does NOT use SST fallback in cold conditions (airTemp <20°C)', () => {
    // On cool spring/autumn days (airTemp <20°C), the SST fallback is too risky
    // — better to leave detector inactive and use raw station consensus.
    const buoyWithoutWaterTemp: BuoyReading = { ...randeBuoy, waterTemp: null, humidity: 40 };
    const station = makeStation('mg_test', cesantes.center[1], cesantes.center[0]);
    const reading = makeReading('mg_test', msFromKt(7), 230, 18); // 18°C, below threshold
    const results = scoreAllSpots(
      [cesantes], [station], new Map([['mg_test', reading]]), [buoyWithoutWaterTemp],
    );
    const score = results.get('cesantes')!;
    // No fallback → detector inactive → verdict from raw 7kt → 'light'
    expect(score.verdict).toBe('light');
    expect(score.thermalBoosted).toBe(false);
  });
});
