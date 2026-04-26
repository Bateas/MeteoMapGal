/**
 * Tests for windTrendAlerts builder — emits UnifiedAlert[] when wind ramp
 * (>6kt in 30min) is detected at a station.
 *
 * Critical path: feeds Telegram alerts when sudden wind changes hit. Uses
 * the real analyzeWindTrend service (no mocking) since it's pure.
 *
 * S123: sixth (final) test file in src/services/alerts/.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildWindTrendAlerts } from './windTrendAlerts';
import type { NormalizedReading } from '../../types/station';

const FIXED_NOW = new Date('2026-04-26T14:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Helpers ─────────────────────────────────────────────────

/** Build a NormalizedReading at a relative offset (minutes from FIXED_NOW). */
function r(opts: {
  stationId?: string;
  offsetMin: number;
  windMs: number;
  dirDeg?: number;
}): NormalizedReading {
  return {
    stationId: opts.stationId ?? 'mg_10001',
    timestamp: new Date(FIXED_NOW.getTime() + opts.offsetMin * 60_000),
    windSpeed: opts.windMs,
    windGust: null,
    windDirection: opts.dirDeg ?? 270,
    temperature: null,
    humidity: null,
    precipitation: null,
    solarRadiation: null,
    pressure: null,
    dewPoint: null,
  };
}

// ── Empty / no-trigger cases ────────────────────────────────

describe('buildWindTrendAlerts — no trigger', () => {
  it('returns [] for empty maps', () => {
    expect(buildWindTrendAlerts(new Map(), new Map())).toEqual([]);
  });

  it('returns [] when station has no current reading', () => {
    const history = new Map([['mg_x', [
      r({ offsetMin: -25, windMs: 2 }),
      r({ offsetMin: -15, windMs: 4 }),
      r({ offsetMin: -5, windMs: 6 }),
    ]]]);
    expect(buildWindTrendAlerts(new Map(), history)).toEqual([]);
  });

  it('returns [] when current reading has null windSpeed', () => {
    const current = new Map([['mg_x', r({ offsetMin: 0, windMs: null as never })]]);
    const history = new Map([['mg_x', [r({ offsetMin: -25, windMs: 5 })]]]);
    expect(buildWindTrendAlerts(current, history)).toEqual([]);
  });

  it('returns [] when wind change is below 6kt threshold', () => {
    // 5kt to 8kt = +3kt in 30min — below RAPID_THRESHOLD_KT (6)
    const current = new Map([['mg_x', r({ offsetMin: 0, windMs: 4.1 })]]);
    const history = new Map([['mg_x', [
      r({ offsetMin: -28, windMs: 2.6 }),
      r({ offsetMin: -18, windMs: 3 }),
      r({ offsetMin: -8, windMs: 3.8 }),
      r({ offsetMin: 0, windMs: 4.1 }),
    ]]]);
    expect(buildWindTrendAlerts(current, history)).toEqual([]);
  });

  it('returns [] when current speed <8kt (filter out gusty calm conditions)', () => {
    // Big delta but tiny absolute — not a "real" sailing-relevant signal
    const current = new Map([['mg_x', r({ offsetMin: 0, windMs: 3.5 })]]); // 6.8 kt
    const history = new Map([['mg_x', [
      r({ offsetMin: -28, windMs: 0.3 }),
      r({ offsetMin: -18, windMs: 0.5 }),
      r({ offsetMin: -8, windMs: 1 }),
      r({ offsetMin: 0, windMs: 3.5 }),
    ]]]);
    expect(buildWindTrendAlerts(current, history)).toEqual([]);
  });
});

// ── Active trigger cases ────────────────────────────────────

describe('buildWindTrendAlerts — rapid ramp emits alert', () => {
  it('emits alert for >6kt ramp with current >=8kt', () => {
    // 4 m/s (~7.8 kt) → 9 m/s (~17.5 kt) = +9.7 kt
    const current = new Map([['mg_10001', r({ offsetMin: 0, windMs: 9 })]]);
    const history = new Map([['mg_10001', [
      r({ offsetMin: -28, windMs: 4 }),
      r({ offsetMin: -18, windMs: 5 }),
      r({ offsetMin: -8, windMs: 7 }),
      r({ offsetMin: 0, windMs: 9 }),
    ]]]);
    const alerts = buildWindTrendAlerts(current, history);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('wind-trend-mg_10001');
    expect(alerts[0].category).toBe('wind-front');
    expect(alerts[0].icon).toBe('wind');
  });

  it('strips source prefix from station name in title', () => {
    const current = new Map([['mg_10001', r({ offsetMin: 0, windMs: 9 })]]);
    const history = new Map([['mg_10001', [
      r({ offsetMin: -28, windMs: 4 }),
      r({ offsetMin: -18, windMs: 5 }),
      r({ offsetMin: -8, windMs: 7 }),
      r({ offsetMin: 0, windMs: 9 }),
    ]]]);
    const title = buildWindTrendAlerts(current, history)[0].title;
    expect(title).toContain('10001');
    expect(title).not.toContain('mg_'); // prefix stripped
  });

  it('severity=high when current >=15kt', () => {
    // 9 m/s ≈ 17.5 kt
    const current = new Map([['mg_x', r({ offsetMin: 0, windMs: 9 })]]);
    const history = new Map([['mg_x', [
      r({ offsetMin: -28, windMs: 4 }),
      r({ offsetMin: -18, windMs: 5 }),
      r({ offsetMin: -8, windMs: 7 }),
      r({ offsetMin: 0, windMs: 9 }),
    ]]]);
    expect(buildWindTrendAlerts(current, history)[0].severity).toBe('high');
  });

  it('severity=moderate when current 8-14kt', () => {
    // 5.5 m/s ≈ 10.7 kt — above 8 but below 15
    const current = new Map([['mg_x', r({ offsetMin: 0, windMs: 5.5 })]]);
    const history = new Map([['mg_x', [
      r({ offsetMin: -28, windMs: 0.5 }),
      r({ offsetMin: -18, windMs: 1.5 }),
      r({ offsetMin: -8, windMs: 3.5 }),
      r({ offsetMin: 0, windMs: 5.5 }),
    ]]]);
    expect(buildWindTrendAlerts(current, history)[0].severity).toBe('moderate');
  });

  it('urgent=true when current >=20kt', () => {
    // 11 m/s ≈ 21.4 kt
    const current = new Map([['mg_x', r({ offsetMin: 0, windMs: 11 })]]);
    const history = new Map([['mg_x', [
      r({ offsetMin: -28, windMs: 5 }),
      r({ offsetMin: -18, windMs: 7 }),
      r({ offsetMin: -8, windMs: 9 }),
      r({ offsetMin: 0, windMs: 11 }),
    ]]]);
    expect(buildWindTrendAlerts(current, history)[0].urgent).toBe(true);
  });

  it('urgent=false when current <20kt', () => {
    const current = new Map([['mg_x', r({ offsetMin: 0, windMs: 9 })]]);
    const history = new Map([['mg_x', [
      r({ offsetMin: -28, windMs: 4 }),
      r({ offsetMin: -18, windMs: 5 }),
      r({ offsetMin: -8, windMs: 7 }),
      r({ offsetMin: 0, windMs: 9 }),
    ]]]);
    expect(buildWindTrendAlerts(current, history)[0].urgent).toBe(false);
  });

  it('detail includes start → current speeds + 30min window', () => {
    const current = new Map([['mg_x', r({ offsetMin: 0, windMs: 9 })]]);
    const history = new Map([['mg_x', [
      r({ offsetMin: -28, windMs: 4 }),
      r({ offsetMin: -18, windMs: 5 }),
      r({ offsetMin: -8, windMs: 7 }),
      r({ offsetMin: 0, windMs: 9 }),
    ]]]);
    const detail = buildWindTrendAlerts(current, history)[0].detail;
    expect(detail).toContain('30min');
    expect(detail).toMatch(/\d+kt/);
    expect(detail).toContain('Viento subió');
  });

  it('detail mentions veering when direction rotates clockwise >30°', () => {
    // SW (225°) → NW (315°) = +90° veer
    const current = new Map([['mg_x', r({ offsetMin: 0, windMs: 9, dirDeg: 315 })]]);
    const history = new Map([['mg_x', [
      r({ offsetMin: -28, windMs: 4, dirDeg: 225 }),
      r({ offsetMin: -18, windMs: 5, dirDeg: 250 }),
      r({ offsetMin: -8, windMs: 7, dirDeg: 290 }),
      r({ offsetMin: 0, windMs: 9, dirDeg: 315 }),
    ]]]);
    expect(buildWindTrendAlerts(current, history)[0].detail).toContain('Rolada');
  });
});

// ── Multi-station case ──────────────────────────────────────

describe('buildWindTrendAlerts — multi-station', () => {
  it('emits one alert per station that meets criteria', () => {
    const current = new Map([
      ['mg_a', r({ stationId: 'mg_a', offsetMin: 0, windMs: 9 })],
      ['mg_b', r({ stationId: 'mg_b', offsetMin: 0, windMs: 10 })],
      ['mg_c', r({ stationId: 'mg_c', offsetMin: 0, windMs: 1 })], // too low
    ]);
    const history = new Map([
      ['mg_a', [
        r({ stationId: 'mg_a', offsetMin: -28, windMs: 4 }),
        r({ stationId: 'mg_a', offsetMin: -18, windMs: 5 }),
        r({ stationId: 'mg_a', offsetMin: -8, windMs: 7 }),
        r({ stationId: 'mg_a', offsetMin: 0, windMs: 9 }),
      ]],
      ['mg_b', [
        r({ stationId: 'mg_b', offsetMin: -28, windMs: 5 }),
        r({ stationId: 'mg_b', offsetMin: -18, windMs: 6 }),
        r({ stationId: 'mg_b', offsetMin: -8, windMs: 8 }),
        r({ stationId: 'mg_b', offsetMin: 0, windMs: 10 }),
      ]],
      ['mg_c', [
        r({ stationId: 'mg_c', offsetMin: -28, windMs: 0 }),
        r({ stationId: 'mg_c', offsetMin: -18, windMs: 0.5 }),
        r({ stationId: 'mg_c', offsetMin: -8, windMs: 1 }),
        r({ stationId: 'mg_c', offsetMin: 0, windMs: 1 }),
      ]],
    ]);
    const alerts = buildWindTrendAlerts(current, history);
    expect(alerts.length).toBe(2);
    expect(alerts.map(a => a.id).sort()).toEqual([
      'wind-trend-mg_a', 'wind-trend-mg_b',
    ]);
  });
});
