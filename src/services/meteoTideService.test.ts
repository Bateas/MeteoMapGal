/**
 * Tests for meteoTideService — observed sea level minus astronomical tide.
 *
 * The fixtures are the real IHM predictions for Vigo on 19-20 July 2026,
 * which is also the pair that was checked live against the REDMAR gauge to
 * confirm both sides share a chart datum. Keeping the real numbers here means
 * a future datum change shows up as a failing test rather than as a plausible
 * wrong answer on the map.
 */

import { describe, it, expect } from 'vitest';
import type { TidePoint } from '../api/tideClient';
import {
  toExtremes,
  astronomicalAt,
  computeMeteoTide,
  surgeLevel,
  formatMeteoTide,
  MAX_PLAUSIBLE_SURGE_M,
} from './meteoTideService';

// IHM Vigo (station 29), real predictions
const JUL19: TidePoint[] = [
  { time: '00:11', height: 0.623, type: 'low' },
  { time: '06:22', height: 3.195, type: 'high' },
  { time: '12:18', height: 0.827, type: 'low' },
  { time: '18:39', height: 3.382, type: 'high' },
];
const JUL20: TidePoint[] = [
  { time: '00:54', height: 0.845, type: 'low' },
  { time: '07:07', height: 3.020, type: 'high' },
  { time: '13:04', height: 1.020, type: 'low' },
  { time: '19:25', height: 3.124, type: 'high' },
];

const day19 = new Date('2026-07-19T12:00:00');
const day20 = new Date('2026-07-20T12:00:00');

function vigoSeries() {
  return [...toExtremes(JUL19, day19), ...toExtremes(JUL20, day20)];
}

describe('toExtremes', () => {
  it('anchors day-scoped times to absolute timestamps in order', () => {
    const e = toExtremes(JUL19, day19);
    expect(e).toHaveLength(4);
    expect(e[0].at.getHours()).toBe(0);
    expect(e[0].at.getMinutes()).toBe(11);
    expect(e[3].heightM).toBe(3.382);
    // sorted ascending
    expect(e[1].at.getTime()).toBeGreaterThan(e[0].at.getTime());
  });

  it('skips malformed points instead of emitting NaN times', () => {
    const bad = [{ time: 'nope', height: 1, type: 'low' } as TidePoint];
    expect(toExtremes(bad, day19)).toHaveLength(0);
  });
});

describe('astronomicalAt', () => {
  it('returns the extreme value exactly at a turn', () => {
    const h = astronomicalAt(vigoSeries(), new Date('2026-07-19T18:39:00'));
    expect(h).toBeCloseTo(3.382, 3);
  });

  it('sits at the midpoint halfway between two extremes', () => {
    // 12:18 low 0.827 -> 18:39 high 3.382. Exact midpoint is 15:28:30 — the
    // cosine is steepest here, so half a minute off already moves it by ~5mm.
    const h = astronomicalAt(vigoSeries(), new Date('2026-07-19T15:28:30'));
    expect(h).toBeCloseTo((0.827 + 3.382) / 2, 3);
  });

  it('brackets across midnight using the next day series', () => {
    // 23:49 on the 19th falls between the 18:39 high and the 00:54 low on the 20th
    const h = astronomicalAt(vigoSeries(), new Date('2026-07-19T23:49:00'));
    expect(h).not.toBeNull();
    expect(h!).toBeGreaterThan(0.845);
    expect(h!).toBeLessThan(3.382);
  });

  it('returns null outside the series rather than extrapolating', () => {
    expect(astronomicalAt(vigoSeries(), new Date('2026-07-18T10:00:00'))).toBeNull();
    expect(astronomicalAt(vigoSeries(), new Date('2026-07-21T10:00:00'))).toBeNull();
  });
});

describe('computeMeteoTide', () => {
  const observedAt = new Date('2026-07-19T23:49:00');
  const now = new Date('2026-07-19T23:55:00');

  it('reproduces the live Vigo check: 1.194 observed is a small positive surge', () => {
    const t = computeMeteoTide(1.194, observedAt, vigoSeries(), now);
    expect(t).not.toBeNull();
    // The live comparison that validated the shared datum came out at +0.17m
    expect(t!.residualM).toBeGreaterThan(0.05);
    expect(t!.residualM).toBeLessThan(0.30);
    expect(t!.level).toBe('notable');
  });

  it('reads a lower-than-predicted sea as a negative surge', () => {
    const t = computeMeteoTide(0.60, observedAt, vigoSeries(), now);
    expect(t!.residualM).toBeLessThan(0);
    expect(formatMeteoTide(t!)).toContain('por debajo');
  });

  it('accepts the PORTUS publication lag — the gauges arrive ~2h old by design', () => {
    // 130min old: the normal REDMAR delivery. A 2h gate would silence this
    // feature almost always, and not because the sea matched the table.
    const lagged = new Date(now.getTime() - 130 * 60_000);
    const t = computeMeteoTide(1.194, lagged, vigoSeries(), now);
    expect(t).not.toBeNull();
    expect(t!.ageMin).toBe(130);
  });

  it('still rejects a genuinely abandoned gauge', () => {
    const old = new Date('2026-07-19T17:00:00'); // ~7h before `now`
    expect(computeMeteoTide(1.194, old, vigoSeries(), now)).toBeNull();
  });

  it('rejects an implausible residual instead of reporting a fake storm surge', () => {
    // A datum mismatch would look like metres, not centimetres
    const t = computeMeteoTide(1.194 + MAX_PLAUSIBLE_SURGE_M + 1, observedAt, vigoSeries(), now);
    expect(t).toBeNull();
  });

  it('returns null with no level reading, rather than assuming zero', () => {
    expect(computeMeteoTide(null, observedAt, vigoSeries(), now)).toBeNull();
    expect(computeMeteoTide(undefined, observedAt, vigoSeries(), now)).toBeNull();
  });

  it('returns null when no prediction brackets the reading', () => {
    const t = computeMeteoTide(1.194, new Date('2026-07-25T10:00:00'), vigoSeries(), new Date('2026-07-25T10:05:00'));
    expect(t).toBeNull();
  });

  it('tolerates mild clock skew (reading stamped slightly ahead)', () => {
    const ahead = new Date(now.getTime() + 30_000);
    const t = computeMeteoTide(1.194, ahead, vigoSeries(), now);
    expect(t).not.toBeNull();
    expect(t!.ageMin).toBe(0);
  });
});

describe('surgeLevel / formatMeteoTide', () => {
  it('treats small residuals as prediction noise, not news', () => {
    expect(surgeLevel(0.05)).toBe('none');
    expect(surgeLevel(-0.10)).toBe('none');
    expect(formatMeteoTide({
      residualM: 0.05, astronomicalM: 1, observedM: 1.05, level: 'none', ageMin: 1,
    })).toBe('Marea segun tabla');
  });

  it('escalates by magnitude regardless of sign', () => {
    expect(surgeLevel(0.20)).toBe('notable');
    expect(surgeLevel(-0.20)).toBe('notable');
    expect(surgeLevel(0.45)).toBe('high');
    expect(surgeLevel(-0.45)).toBe('high');
  });

  it('says the direction in words, since the sign is what people misread', () => {
    const up = formatMeteoTide({
      residualM: 0.42, astronomicalM: 1, observedM: 1.42, level: 'high', ageMin: 2,
    });
    expect(up).toBe('Agua 42 cm por encima de tabla');
  });
});
