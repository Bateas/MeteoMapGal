/**
 * Tests for bocanaDetector — morning terral (land-breeze) detection for Ría de
 * Vigo, fed to the 24/7 ingestor analyzer. Pure function with an injectable
 * `hour` param (no clock needed). Covers the gates (time window, Rande temps,
 * ΔT, humidity), buoy-confirmed vs ΔT-only paths, the cloud kill, and the
 * confidence threshold.
 */
import { describe, it, expect } from 'vitest';
import { detectBocana } from './bocanaDetector';
import type { BuoyReading } from '../api/buoyClient';

const RANDE = 1251;
const VIGO = 3221;

function buoy(stationId: number, o: Partial<BuoyReading> = {}): BuoyReading {
  return {
    stationId, stationName: `buoy-${stationId}`, timestamp: new Date().toISOString(),
    waveHeight: null, waveHeightMax: null, wavePeriod: null, wavePeriodMean: null, waveDir: null,
    windSpeed: null, windDir: null, windGust: null,
    waterTemp: null, airTemp: null, airPressure: null,
    currentSpeed: null, currentDir: null, salinity: null, seaLevel: null,
    humidity: null, dewPoint: null,
    ...o,
  };
}

/** Rande with warm water (ΔT favourable) + humid. */
function rande(deltaT = 3, humidity = 80): BuoyReading {
  return buoy(RANDE, { airTemp: 12, waterTemp: 12 + deltaT, humidity });
}

const MORNING = 9; // inside 6-11 window

// ── Gates ────────────────────────────────────────────────

describe('detectBocana — gates', () => {
  it('inactive outside the morning window (14h)', () => {
    const r = detectBocana([rande(), buoy(VIGO, { windSpeed: 4, windDir: 60 })], 200, 14);
    expect(r.active).toBe(false);
  });

  it('inactive without the Rande buoy', () => {
    const r = detectBocana([buoy(VIGO, { windSpeed: 4, windDir: 60 })], 200, MORNING);
    expect(r.active).toBe(false);
  });

  it('inactive when Rande lacks water/air temps', () => {
    const r = detectBocana([buoy(RANDE, { humidity: 80 })], 200, MORNING);
    expect(r.active).toBe(false);
  });

  it('inactive when ΔT (water-air) below threshold', () => {
    const r = detectBocana([rande(0.5)], 200, MORNING); // ΔT 0.5 < 1.5
    expect(r.active).toBe(false);
  });

  it('inactive when humidity below threshold', () => {
    const r = detectBocana([rande(3, 50)], 200, MORNING); // hum 50 < 65
    expect(r.active).toBe(false);
  });
});

// ── Detection paths ──────────────────────────────────────

describe('detectBocana — detection', () => {
  it('buoy-confirmed NE wind → active, boost from buoy, reports direction', () => {
    const r = detectBocana(
      [rande(3, 85), buoy(VIGO, { windSpeed: 5, windDir: 60 })], // 5 m/s NE
      200, MORNING,
    );
    expect(r.active).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(60);
    expect(r.boostKt).toBeGreaterThan(2);
    expect(r.buoyWindKt).not.toBeNull();
    expect(r.buoyDir).toBe(60);
    expect(r.signal).toMatch(/Terral/);
  });

  it('ΔT-only path (no buoy wind confirmation) → active with conservative boost', () => {
    const r = detectBocana([rande(3, 80)], 200, MORNING); // no wind buoy
    expect(r.active).toBe(true);
    expect(r.buoyWindKt).toBeNull();
    expect(r.boostKt).toBeGreaterThanOrEqual(2);
    expect(r.signal).toMatch(/probable/i);
  });

  it('wind buoy blowing SW (wrong direction) does not count as confirmation', () => {
    const r = detectBocana(
      [rande(3, 80), buoy(VIGO, { windSpeed: 6, windDir: 220 })], // SW, not bocana dir
      200, MORNING,
    );
    // Still may activate via ΔT path, but NOT buoy-confirmed
    expect(r.buoyWindKt).toBeNull();
  });

  it('cloudy after 8AM (solar<50) caps confidence → inactive', () => {
    const r = detectBocana([rande(3, 80)], 30, 9); // solar 30, hour 9
    expect(r.active).toBe(false); // capped at 30 < 40 threshold
  });

  it('clear sky (solar≥100) boosts confidence vs no solar data', () => {
    const clear = detectBocana([rande(3, 80)], 200, MORNING);
    const noData = detectBocana([rande(3, 80)], null, MORNING);
    expect(clear.confidence).toBeGreaterThan(noData.confidence);
  });

  it('weak ΔT just over threshold with no other signals → below 40% → inactive', () => {
    const r = detectBocana([rande(1.5)], null, MORNING); // ΔT 1.5, hum default 80
    // ΔT 1.5→15% + hum 80→16% + no buoy + no-solar +7 = ~38% < 40
    expect(r.active).toBe(false);
  });
});
