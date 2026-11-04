/**
 * Tests for bocanaDetector — morning terral (land-breeze) detection for Ría de
 * Vigo, fed to the 24/7 ingestor analyzer. Pure function with an injectable
 * `hour` param (no clock needed). Covers the gates (time window, Rande temps,
 * ΔT, humidity), buoy-confirmed vs ΔT-only paths, the cloud kill, and the
 * confidence threshold.
 */
import { describe, it, expect } from 'vitest';
import { detectBocana, bocanaFigureKt } from './bocanaDetector';
import type { BuoyReading } from '../api/buoyClient';

const RANDE = 1251;
const VIGO = 3221;
const MARIN = 3223;

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

// ── The figure: nothing added, and only the buoy on this water ──

describe('bocanaFigureKt — a terral shows a measured wind', () => {
  // 3-nov 08:30: 12.9 kt at the stations, Vigo 15.6, and the app said 20.9 (FUERTE).
  it('the Vigo buoy over the consensus: the buoy, not their sum', () => {
    const r = detectBocana([rande(3, 85), buoy(VIGO, { windSpeed: 8, windDir: 60 })], 200, MORNING);
    expect(r.active).toBe(true);
    expect(bocanaFigureKt(12.9, r)).toBeCloseTo(15.6, 1);
  });

  // 4-nov 09:33: 5.9 at the stations, Vigo 6.8, and the app said 11.9.
  it('the Vigo buoy near the consensus moves it no further than the buoy', () => {
    const r = detectBocana([rande(3, 85), buoy(VIGO, { windSpeed: 3.5, windDir: 60 })], 200, MORNING);
    expect(bocanaFigureKt(5.9, r)).toBeCloseTo(6.8, 1);
  });

  it('a consensus above the buoy stays', () => {
    const r = detectBocana([rande(3, 85), buoy(VIGO, { windSpeed: 3, windDir: 60 })], 200, MORNING);
    expect(bocanaFigureKt(9, r)).toBe(9);
  });

  // 31-oct 09:34: Vigo 5.2, Marin 14.6, gust 7, and the app said 13.7.
  it('Marin confirms the terral but does not set the figure', () => {
    const r = detectBocana(
      [rande(3, 85), buoy(VIGO, { windSpeed: 2.7, windDir: 60 }), buoy(MARIN, { windSpeed: 7.5, windDir: 60 })],
      200, MORNING,
    );
    expect(r.active).toBe(true);
    expect(r.signal).toMatch(/boya de Marín/);
    expect(bocanaFigureKt(5.7, r)).toBeCloseTo(5.7, 1);
  });

  it('Marin alone gives no figure', () => {
    const r = detectBocana([rande(3, 85), buoy(MARIN, { windSpeed: 7.5, windDir: 60 })], 200, MORNING);
    expect(r.active).toBe(true);
    expect(bocanaFigureKt(5.7, r)).toBe(5.7);
  });

  it('with no buoy measuring it, the temperature difference alone moves nothing', () => {
    const r = detectBocana([rande(3, 80)], 200, MORNING);
    expect(r.active).toBe(true);
    expect(bocanaFigureKt(4, r)).toBe(4);
  });

  it('a Vigo reading older than 45 min does not set the figure', () => {
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const r = detectBocana([rande(3, 85), buoy(VIGO, { windSpeed: 8, windDir: 60, timestamp: old })], 200, MORNING);
    expect(r.localBuoyKt).toBeNull();
    expect(bocanaFigureKt(5, r)).toBe(5);
  });

  it('Vigo blowing from the sea does not set the figure', () => {
    const r = detectBocana([rande(3, 85), buoy(VIGO, { windSpeed: 8, windDir: 220 })], 200, MORNING);
    expect(bocanaFigureKt(5, r)).toBe(5);
  });

  it('with no terral the consensus stays', () => {
    const r = detectBocana([rande(0.5), buoy(VIGO, { windSpeed: 8, windDir: 60 })], 200, MORNING);
    expect(bocanaFigureKt(5, r)).toBe(5);
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
    expect(r.localBuoyKt).toBeCloseTo(9.7, 1);
    expect(r.buoyWindKt).not.toBeNull();
    expect(r.buoyDir).toBe(60);
    expect(r.signal).toMatch(/Terral/);
  });

  it('ΔT-only path (no buoy wind confirmation) → active with conservative boost', () => {
    const r = detectBocana([rande(3, 80)], 200, MORNING); // no wind buoy
    expect(r.active).toBe(true);
    expect(r.buoyWindKt).toBeNull();
    expect(r.localBuoyKt).toBeNull();
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
