/**
 * Tests for downburstAlerts builder — pipeline wire only.
 *
 * Physics tested separately in `downburstRiskService.test.ts`. Here we
 * only verify the alert shape, store-input mapping, and null-guarding.
 */
import { describe, it, expect } from 'vitest';
import { buildDownburstAlerts } from './downburstAlerts';
import type { NormalizedReading } from '../../types/station';
import type { HourlyForecast } from '../../types/forecast';

// ── Fixtures ────────────────────────────────────────────────

function reading(stationId: string, windSpeed: number, windGust: number): NormalizedReading {
  return {
    stationId,
    timestamp: new Date(),
    windSpeed,
    windGust,
    windDirection: 200,
    temperature: 20,
    humidity: 50,
    precipitation: 0,
    solarRadiation: 500,
    pressure: 1015,
    dewPoint: 10,
  };
}

function forecastHour(overrides: Partial<HourlyForecast>): HourlyForecast {
  return {
    time: new Date(), // now
    temperature: 20,
    humidity: 50,
    windSpeed: 5,
    windDirection: 200,
    windGusts: 8,
    precipitation: 0,
    precipProbability: 30,
    cloudCover: 50,
    pressure: 1015,
    solarRadiation: 500,
    cape: 200,
    boundaryLayerHeight: 800,
    visibility: 10000,
    liftedIndex: 0,
    cin: 0,
    snowLevel: 2000,
    skyState: null,
    temperature500hPa: -8,
    isDay: true,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('buildDownburstAlerts', () => {
  it('returns [] when currentReadings is missing or empty', () => {
    expect(buildDownburstAlerts(undefined, [forecastHour({})])).toEqual([]);
    expect(buildDownburstAlerts(new Map(), [forecastHour({})])).toEqual([]);
  });

  it('returns [] when forecast is missing or empty', () => {
    const readings = new Map([['s1', reading('s1', 5, 12)]]);
    expect(buildDownburstAlerts(readings, undefined)).toEqual([]);
    expect(buildDownburstAlerts(readings, [])).toEqual([]);
  });

  it('returns [] when no station reports BOTH wind + gust', () => {
    const r1 = reading('s1', 5, 0);  // no gust
    const r2 = reading('s2', 0, 12); // no wind
    const readings = new Map([['s1', r1], ['s2', r2]]);
    expect(buildDownburstAlerts(readings, [forecastHour({})])).toEqual([]);
  });

  it('returns [] when conditions calm (<3 signals)', () => {
    const readings = new Map([['s1', reading('s1', 5, 6)]]); // ratio 1.2 (below)
    const forecast = [forecastHour({ temperature500hPa: -5, cape: 100, liftedIndex: 1 })];
    expect(buildDownburstAlerts(readings, forecast)).toEqual([]);
  });

  it('emits high severity when all 4 signals align', () => {
    const readings = new Map([['s1', reading('s1', 4, 9)]]); // ratio 2.25
    const forecast = [forecastHour({
      temperature500hPa: -18, // sig 2
      cape: 1200, liftedIndex: -3, // sig 3
      cloudCover: 85, precipitation: 0.2, // sig 4
    })];
    const alerts = buildDownburstAlerts(readings, forecast);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('high');
    expect(alerts[0].category).toBe('downburst');
    expect(alerts[0].urgent).toBe(true);
    expect(alerts[0].score).toBeGreaterThanOrEqual(80);
    expect(alerts[0].title).toContain('ALTO');
  });

  it('emits moderate severity when 3 of 4 signals align', () => {
    const readings = new Map([['s1', reading('s1', 4, 9)]]); // ratio 2.25 ✓
    const forecast = [forecastHour({
      temperature500hPa: -18,                                // ✓
      cape: 1200, liftedIndex: -3,                           // ✓
      cloudCover: 50, precipitation: 0.2,                    // ✗ (low cloud)
    })];
    const alerts = buildDownburstAlerts(readings, forecast);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('moderate');
    expect(alerts[0].urgent).toBe(false);
    expect(alerts[0].category).toBe('downburst');
  });

  it('picks nearest forecast hour to NOW (not just first)', () => {
    const readings = new Map([['s1', reading('s1', 4, 9)]]);
    const now = Date.now();
    const distantPast = new Date(now - 6 * 3600 * 1000);
    const closerNow = new Date(now);
    const distantFuture = new Date(now + 6 * 3600 * 1000);

    // Bad atmosphere far in past, good atmosphere now, bad in future
    const forecast = [
      forecastHour({ time: distantPast, temperature500hPa: -5, cape: 100, liftedIndex: 1, cloudCover: 30, precipitation: 0 }),
      forecastHour({ time: closerNow,   temperature500hPa: -18, cape: 1200, liftedIndex: -3, cloudCover: 85, precipitation: 0.2 }),
      forecastHour({ time: distantFuture, temperature500hPa: -5, cape: 100, liftedIndex: 1, cloudCover: 30, precipitation: 0 }),
    ];
    const alerts = buildDownburstAlerts(readings, forecast);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('high');
  });

  it('includes confidence number in the alert', () => {
    const readings = new Map([['s1', reading('s1', 4, 9)]]);
    const forecast = [forecastHour({
      temperature500hPa: -18, cape: 1200, liftedIndex: -3,
      cloudCover: 85, precipitation: 0.2,
    })];
    const alerts = buildDownburstAlerts(readings, forecast);
    expect(alerts[0].confidence).toBeGreaterThan(0);
    expect(alerts[0].confidence).toBeLessThanOrEqual(100);
  });
});
