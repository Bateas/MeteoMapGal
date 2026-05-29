/**
 * Tests for lapseRateService — OLS lapse-rate regression + thermal-inversion
 * classification. Feeds the inversion alert pipeline, so the edge cases that
 * matter are: too few stations, insufficient altitude spread, degenerate
 * (identical temps → ssTot=0), and the conservative inversion gating
 * (slope ≥ MIN_INVERSION_SLOPE AND R² ≥ MIN_R_SQUARED_FOR_ALERT).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  computeLinearRegression,
  analyzeThermalProfile,
  extractStationTemps,
  MIN_STATIONS_FOR_ANALYSIS,
  type StationTempData,
} from './lapseRateService';
import type { NormalizedStation, NormalizedReading } from '../types/station';

// ── Fixtures ─────────────────────────────────────────────

/** Build StationTempData for a given altitude/temperature (lat/lon irrelevant here). */
function st(id: string, altitude: number, temperature: number): StationTempData {
  return { stationId: id, name: id, lat: 42.3, lon: -7.9, altitude, temperature };
}

/** Linear profile T = base + altitude * perMeter, over 4 altitudes with good spread. */
function linearProfile(base: number, perMeter: number): StationTempData[] {
  return [50, 200, 400, 650].map((a, i) =>
    st(`s${i}`, a, Math.round((base + a * perMeter) * 100) / 100),
  );
}

// ── computeLinearRegression ──────────────────────────────

describe('computeLinearRegression', () => {
  it('returns null below the minimum station count', () => {
    const few = [st('a', 50, 15), st('b', 300, 12), st('c', 600, 9)]; // 3 < 4
    expect(computeLinearRegression(few)).toBeNull();
  });

  it('returns null when altitude spread is too small (<150m)', () => {
    const flat = [st('a', 100, 15), st('b', 120, 14.8), st('c', 140, 14.6), st('d', 160, 14.4)];
    expect(computeLinearRegression(flat)).toBeNull();
  });

  it('normal cooling → negative slope', () => {
    const r = computeLinearRegression(linearProfile(18, -0.008)); // -8°C/km
    expect(r).not.toBeNull();
    expect(r!.slopePerKm).toBeLessThan(0);
    expect(r!.slopePerKm).toBeCloseTo(-8, 0);
    expect(r!.rSquared).toBeGreaterThan(0.95);
  });

  it('inversion → positive slope', () => {
    const r = computeLinearRegression(linearProfile(12, 0.008)); // +8°C/km
    expect(r!.slopePerKm).toBeCloseTo(8, 0);
    expect(r!.stationCount).toBe(4);
  });

  it('identical temperatures (ssTot=0) → rSquared clamped to 0, no NaN', () => {
    const flat = [st('a', 50, 15), st('b', 250, 15), st('c', 450, 15), st('d', 650, 15)];
    const r = computeLinearRegression(flat);
    expect(r).not.toBeNull();
    expect(r!.rSquared).toBe(0);
    expect(Number.isNaN(r!.slopePerKm)).toBe(false);
    expect(r!.slopePerKm).toBeCloseTo(0, 3);
  });
});

// ── analyzeThermalProfile ────────────────────────────────

describe('analyzeThermalProfile', () => {
  it('insufficient stations → insufficient-data', () => {
    const p = analyzeThermalProfile([st('a', 50, 15), st('b', 300, 12)]);
    expect(p.status).toBe('insufficient-data');
    expect(p.hasInversion).toBe(false);
    expect(p.regression).toBeNull();
  });

  it('insufficient altitude spread → insufficient-data', () => {
    const flat = [st('a', 100, 15), st('b', 120, 14.8), st('c', 140, 14.6), st('d', 160, 14.4)];
    const p = analyzeThermalProfile(flat);
    expect(p.status).toBe('insufficient-data');
    expect(p.regression).toBeNull();
  });

  it('normal cooling gradient → status normal, no inversion', () => {
    const p = analyzeThermalProfile(linearProfile(18, -0.0065));
    expect(p.status).toBe('normal');
    expect(p.hasInversion).toBe(false);
    expect(p.overallLapseRate).toBeLessThan(0);
  });

  it('barely-positive slope below MIN_INVERSION_SLOPE → still normal', () => {
    const p = analyzeThermalProfile(linearProfile(15, 0.0005)); // +0.5°C/km < 1.0
    expect(p.status).toBe('normal');
    expect(p.hasInversion).toBe(false);
  });

  it('moderate positive slope with high R² → weak-inversion', () => {
    const p = analyzeThermalProfile(linearProfile(14, 0.0036)); // +3.6°C/km
    expect(p.status).toBe('weak-inversion');
    expect(p.hasInversion).toBe(true);
    expect(p.summary).toMatch(/débil/i);
  });

  it('strong positive slope (≥5°C/km) with high R² → strong-inversion', () => {
    const p = analyzeThermalProfile(linearProfile(13, 0.008)); // +8°C/km
    expect(p.status).toBe('strong-inversion');
    expect(p.hasInversion).toBe(true);
    expect(p.summary).toMatch(/FUERTE/);
  });
});

// ── extractStationTemps ──────────────────────────────────

describe('extractStationTemps', () => {
  const NOW = new Date('2026-02-10T08:00:00');
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  function station(id: string, altitude: number): NormalizedStation {
    return { id, name: id, lat: 42.3, lon: -7.9, altitude, source: 'meteogalicia', tempOnly: false };
  }
  function reading(id: string, temperature: number | null, ageMin = 0): NormalizedReading {
    return {
      stationId: id, timestamp: new Date(NOW.getTime() - ageMin * 60_000),
      windSpeed: null, windGust: null, windDirection: null,
      temperature, humidity: null, precipitation: null,
      solarRadiation: null, pressure: null, dewPoint: null,
    };
  }

  it('excludes stations below MIN_VALID_ALTITUDE (bad 0/low altitude from APIs)', () => {
    const stations = [station('low', 10), station('ok', 300)];
    const readings = new Map([['low', reading('low', 12)], ['ok', reading('ok', 9)]]);
    const out = extractStationTemps(stations, readings);
    expect(out.map((s) => s.stationId)).toEqual(['ok']);
  });

  it('excludes null temperatures and stale readings', () => {
    const stations = [station('null', 300), station('stale', 300), station('fresh', 300)];
    const readings = new Map([
      ['null', reading('null', null)],
      ['stale', reading('stale', 10, 180)], // 3h old > 2h cap
      ['fresh', reading('fresh', 11, 30)],
    ]);
    const out = extractStationTemps(stations, readings);
    expect(out.map((s) => s.stationId)).toEqual(['fresh']);
  });

  it('keeps fresh, valid, high-altitude stations', () => {
    const stations = Array.from({ length: MIN_STATIONS_FOR_ANALYSIS }, (_, i) => station(`s${i}`, 100 + i * 150));
    const readings = new Map(stations.map((s, i) => [s.id, reading(s.id, 15 - i)]));
    const out = extractStationTemps(stations, readings);
    expect(out).toHaveLength(MIN_STATIONS_FOR_ANALYSIS);
  });
});
