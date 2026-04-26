/**
 * Tests for cesantesCanalizationDetector — predicts local SW wind boost
 * in sheltered Cesantes valley (where preferred MG stations subvaloran).
 *
 * Two modes: synoptic SW canalization (Mode 1) and thermal breeze (Mode 2).
 * Used by SpotPopup to override wind display when prediction > measured by ≥4kt.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { predictCesantesCanalization, computeMouthHumidity } from './cesantesCanalizationDetector';
import type { BuoyReading } from '../api/buoyClient';
import type { NormalizedStation, NormalizedReading } from '../types/station';

// ── Builder helpers ───────────────────────────────────────────

function buoy(over: Partial<BuoyReading> & { stationId: number }): BuoyReading {
  return {
    stationName: 'Test Buoy',
    timestamp: new Date('2026-04-26T14:00:00Z').toISOString(),
    waveHeight: null,
    waveHeightMax: null,
    wavePeriod: null,
    wavePeriodMean: null,
    waveDir: null,
    windSpeed: null,
    windDir: null,
    windGust: null,
    waterTemp: null,
    airTemp: null,
    airPressure: null,
    currentSpeed: null,
    currentDir: null,
    salinity: null,
    seaLevel: null,
    humidity: null,
    dewPoint: null,
    ...over,
  } as BuoyReading;
}

function station(over: Partial<NormalizedStation> & { id: string; lat: number; lon: number }): NormalizedStation {
  return {
    source: 'meteogalicia',
    name: over.id,
    altitude: 10,
    ...over,
  };
}

function reading(over: Partial<NormalizedReading> & { stationId: string }): NormalizedReading {
  return {
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

// ── Mode 1: Synoptic SW canalization ──────────────────────────

describe('predictCesantesCanalization — Mode 1 synoptic SW', () => {
  beforeEach(() => {
    // Force NON-thermal hour so Mode 1 doesn't get bonus
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T08:00:00Z')); // 08h UTC, before thermal window
  });
  afterEach(() => vi.useRealTimers());

  it('returns inactive when no buoys provided', () => {
    const r = predictCesantesCanalization([], null);
    expect(r.active).toBe(false);
    expect(r.confidence).toBe(0);
    expect(r.predictedKt).toBeNull();
  });

  it('returns inactive when mouth buoy has no SW wind', () => {
    // N wind, not SW
    const r = predictCesantesCanalization(
      [buoy({ stationId: 2248, windSpeed: 8, windDir: 0, stationName: 'Cabo Silleiro' })],
      null,
    );
    expect(r.active).toBe(false);
  });

  it('returns inactive when SW wind is too weak (<4 m/s)', () => {
    const r = predictCesantesCanalization(
      [buoy({ stationId: 2248, windSpeed: 3, windDir: 230, stationName: 'Cabo Silleiro' })],
      null,
    );
    expect(r.active).toBe(false);
  });

  it('activates with mouth buoy SW ≥4 m/s', () => {
    // 6 m/s × 1.4 boost = 8.4 m/s = 16.3kt → active
    const r = predictCesantesCanalization(
      [buoy({ stationId: 2248, windSpeed: 6, windDir: 230, stationName: 'Cabo Silleiro' })],
      null,
    );
    expect(r.active).toBe(true);
    expect(r.predictedKt).toBeGreaterThanOrEqual(10);
    expect(r.boostFactor).toBeCloseTo(1.4, 1);
    expect(r.predictedDir).toBe(230);
    expect(r.signals[0]).toContain('SW sinóptico');
    expect(r.signals[0]).toContain('Cabo Silleiro');
  });

  it('promotes to BOOST_HUMID with mouthHumidity ≥85', () => {
    const r = predictCesantesCanalization(
      [buoy({ stationId: 2248, windSpeed: 6, windDir: 230, stationName: 'Cabo Silleiro' })],
      88,
    );
    expect(r.active).toBe(true);
    expect(r.boostFactor).toBeCloseTo(1.7, 1);
    expect(r.confidence).toBe(70);
    expect(r.severity).toBe('moderate');
    expect(r.signals.some((s) => s.includes('HR'))).toBe(true);
  });

  it('promotes to BOOST_FOG with webcamFogInMouth=true', () => {
    const r = predictCesantesCanalization(
      [buoy({ stationId: 2248, windSpeed: 6, windDir: 230, stationName: 'Cabo Silleiro' })],
      90,
      true,
    );
    expect(r.boostFactor).toBeCloseTo(2.0, 1);
    expect(r.confidence).toBe(85);
    expect(r.severity).toBe('high');
    expect(r.signals.some((s) => s.includes('Niebla'))).toBe(true);
  });

  it('caps boost at MAX_BOOST=2.5', () => {
    // Even with thermal+fog stack, cap kicks in
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z')); // thermal hour
    const r = predictCesantesCanalization(
      [buoy({ stationId: 2248, windSpeed: 6, windDir: 230, stationName: 'Cabo Silleiro' })],
      90,
      true,
      18, // warm air
      14, // ΔT = 4°C
    );
    expect(r.boostFactor).toBeLessThanOrEqual(2.5);
  });

  it('picks strongest of multiple mouth buoys', () => {
    const r = predictCesantesCanalization(
      [
        buoy({ stationId: 2248, windSpeed: 5, windDir: 220, stationName: 'Cabo Silleiro' }),
        buoy({ stationId: 1252, windSpeed: 9, windDir: 250, stationName: 'Cíes' }),
      ],
      null,
    );
    expect(r.signals[0]).toContain('Cíes');
  });

  it('SW direction range includes S-SSE (160°) through WSW (280°)', () => {
    const broadSouth = predictCesantesCanalization(
      [buoy({ stationId: 2248, windSpeed: 6, windDir: 165, stationName: 'Cabo Silleiro' })],
      null,
    );
    expect(broadSouth.active).toBe(true);
    const wsw = predictCesantesCanalization(
      [buoy({ stationId: 2248, windSpeed: 6, windDir: 275, stationName: 'Cabo Silleiro' })],
      null,
    );
    expect(wsw.active).toBe(true);
  });
});

// ── Mode 2: Thermal breeze (Apr-Oct, 12-20h, ΔT≥2°C, air≥16°C) ──

describe('predictCesantesCanalization — Mode 2 thermal breeze', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires in thermal window with required conditions', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z')); // 15h, in window
    const r = predictCesantesCanalization(
      [], // no buoys → forces Mode 2 path
      null, false,
      18, // airTempLocal warm enough
      14, // waterTemp → ΔT = 4°C
      6,  // localStationKt baseline
    );
    expect(r.active).toBe(true);
    expect(r.predictedDir).toBe(230);
    expect(r.confidence).toBe(70);
    expect(r.signals.some((s) => s.includes('Brisa térmica'))).toBe(true);
  });

  it('does NOT fire outside thermal window (early morning)', () => {
    vi.setSystemTime(new Date('2026-04-26T07:00:00Z')); // 07h
    const r = predictCesantesCanalization([], null, false, 18, 14, 6);
    expect(r.active).toBe(false);
  });

  it('does NOT fire after thermal window (night)', () => {
    vi.setSystemTime(new Date('2026-04-26T22:00:00Z')); // 22h
    const r = predictCesantesCanalization([], null, false, 18, 14, 6);
    expect(r.active).toBe(false);
  });

  it('requires ΔT ≥2°C', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z'));
    const r = predictCesantesCanalization([], null, false, 18, 17, 6); // ΔT=1
    expect(r.active).toBe(false);
  });

  it('requires airTemp ≥16°C', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z'));
    const r = predictCesantesCanalization([], null, false, 14, 10, 6); // air<16
    expect(r.active).toBe(false);
  });

  it('uses default baseKt=6 when localStationKt not provided', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z'));
    // ΔT=4°C → +8kt thermal boost, base 6 → predicted 14kt
    const r = predictCesantesCanalization([], null, false, 18, 14);
    expect(r.active).toBe(true);
    expect(r.predictedKt).toBeGreaterThanOrEqual(10);
  });

  it('marks severity=high when predictedKt ≥15', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z'));
    // baseKt 8 + ΔT 5°C × 2 = +8 (capped) → 16kt
    const r = predictCesantesCanalization([], null, false, 20, 15, 8);
    expect(r.severity).toBe('high');
  });

  it('returns inactive when result <10kt', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z'));
    // baseKt 2 + ΔT 2°C × 2 = +4 → 6kt < 10kt threshold
    const r = predictCesantesCanalization([], null, false, 18, 16, 2);
    expect(r.active).toBe(false);
  });
});

// ── Output shape ──────────────────────────────────────────────

describe('predictCesantesCanalization — output shape', () => {
  it('returns full CesantesPrediction shape', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T08:00:00Z'));
    const r = predictCesantesCanalization(
      [buoy({ stationId: 2248, windSpeed: 6, windDir: 230, stationName: 'Cabo Silleiro' })],
      null,
    );
    expect(r).toHaveProperty('active');
    expect(r).toHaveProperty('confidence');
    expect(r).toHaveProperty('predictedKt');
    expect(r).toHaveProperty('predictedDir');
    expect(r).toHaveProperty('boostFactor');
    expect(r).toHaveProperty('signals');
    expect(r).toHaveProperty('severity');
    expect(Array.isArray(r.signals)).toBe(true);
    expect(['info', 'moderate', 'high']).toContain(r.severity);
    vi.useRealTimers();
  });
});

// ── computeMouthHumidity helper ───────────────────────────────

describe('computeMouthHumidity', () => {
  it('returns null when no mouth stations', () => {
    expect(computeMouthHumidity([], new Map())).toBeNull();
  });

  it('returns null when no readings have humidity', () => {
    const stations = [station({ id: 's1', lat: 42.20, lon: -8.85 })];
    const readings = new Map([['s1', reading({ stationId: 's1', humidity: null })]]);
    expect(computeMouthHumidity(stations, readings)).toBeNull();
  });

  it('filters out stations outside the mouth bbox', () => {
    // Interior ría station (lon > -8.78) should be excluded
    const stations = [
      station({ id: 'interior', lat: 42.20, lon: -8.70 }), // too far east
      station({ id: 'south', lat: 42.10, lon: -8.85 }),     // too far south
    ];
    const readings = new Map([
      ['interior', reading({ stationId: 'interior', humidity: 90 })],
      ['south', reading({ stationId: 'south', humidity: 90 })],
    ]);
    expect(computeMouthHumidity(stations, readings)).toBeNull();
  });

  it('returns 75th-percentile humidity from mouth stations', () => {
    const stations = [
      station({ id: 'a', lat: 42.20, lon: -8.85 }),
      station({ id: 'b', lat: 42.22, lon: -8.86 }),
      station({ id: 'c', lat: 42.18, lon: -8.84 }),
      station({ id: 'd', lat: 42.25, lon: -8.83 }),
    ];
    const readings = new Map([
      ['a', reading({ stationId: 'a', humidity: 70 })],
      ['b', reading({ stationId: 'b', humidity: 80 })],
      ['c', reading({ stationId: 'c', humidity: 90 })],
      ['d', reading({ stationId: 'd', humidity: 95 })],
    ]);
    // 75th percentile of [70,80,90,95] → idx=floor(4*0.75)=3 → 95
    expect(computeMouthHumidity(stations, readings)).toBe(95);
  });
});
