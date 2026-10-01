/**
 * The spot's wind trend: near stations, never an excluded anemometer, two moving
 * together, and the figure measured. The case that set it: Cesantes, 1-oct 12:03,
 * «Viento 4 kt» next to «+7kt/30min subiendo» with the water a mirror, because two
 * Wunderground stations 11-12 km away (Moaña, and Marín in the other ría) went
 * 1.9 → 5.8 kt while every station within 6 km read 0-2 kt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NormalizedReading } from '../types/station';
import { analyzeSpotWindTrend, analyzeWindTrend, type TrendStation } from './windTrendService';

const NOW = Date.UTC(2026, 9, 1, 10, 3); // 12:03 Madrid
const KT = 0.514444;

function reading(stationId: string, minAgo: number, kt: number, dir = 300): NormalizedReading {
  return {
    stationId, timestamp: new Date(NOW - minAgo * 60_000), windSpeed: kt * KT, windGust: null, windDirection: dir,
    temperature: null, humidity: null, precipitation: null, solarRadiation: null, pressure: null, dewPoint: null,
  };
}

/** A station's last 30 min, from `fromKt` to `toKt`, one reading every 5 min. */
function ramp(id: string, fromKt: number, toKt: number): NormalizedReading[] {
  const steps = 6;
  return Array.from({ length: steps }, (_, i) => reading(id, 25 - i * 5, fromKt + ((toKt - fromKt) * i) / (steps - 1)));
}

function inputs(series: Record<string, NormalizedReading[]>) {
  const history = new Map(Object.entries(series));
  const current = new Map(Object.entries(series).map(([id, rs]) => [id, rs[rs.length - 1]]));
  return { history, current };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('analyzeWindTrend — one station', () => {
  it('measures the change and the minutes it took', () => {
    const t = analyzeWindTrend(ramp('a', 2, 6))!;
    expect(t.signal).toBe('building');
    expect(t.deltaKt).toBeCloseTo(4, 3);
    expect(t.minutes).toBe(25);
    expect(t.stations).toBe(1);
  });
});

describe('analyzeSpotWindTrend — what the spot shows', () => {
  const cesantes: TrendStation[] = [
    { id: 'wu_IREDON36', distKm: 1.7, preferred: false },
    { id: 'mg_10154', distKm: 2.1, preferred: true },
    { id: 'wu_IREDON16', distKm: 5.5, preferred: true },
    { id: 'wu_IMARN7', distKm: 10.7, preferred: false },
    { id: 'wu_IMOAA9', distKm: 11.7, preferred: false },
  ];

  it('Cesantes 1-oct 12:03: far stations rising do not make the spot rise', () => {
    const { history, current } = inputs({
      wu_IREDON36: ramp('wu_IREDON36', 0, 1.9),
      mg_10154: ramp('mg_10154', 1.6, 1.6),
      wu_IREDON16: ramp('wu_IREDON16', 0, 1.9),
      wu_IMARN7: ramp('wu_IMARN7', 1.9, 5.8),
      wu_IMOAA9: ramp('wu_IMOAA9', 1.9, 5.8),
    });
    expect(analyzeSpotWindTrend(cesantes, history, current, 6)).toBeNull();
  });

  it('one near station alone is not a trend (two sources, the rule of rigour)', () => {
    const { history, current } = inputs({
      wu_IREDON36: ramp('wu_IREDON36', 1, 7),
      mg_10154: ramp('mg_10154', 1.6, 1.6),
    });
    expect(analyzeSpotWindTrend(cesantes, history, current, 6)).toBeNull();
  });

  it('two near stations rising together: a trend, with their median and the minutes measured', () => {
    const { history, current } = inputs({
      wu_IREDON36: ramp('wu_IREDON36', 1, 5),
      mg_10154: ramp('mg_10154', 2, 8),
      wu_IREDON16: ramp('wu_IREDON16', 2, 2),
    });
    const t = analyzeSpotWindTrend(cesantes, history, current, 6)!;
    expect(t.signal).toBe('building');
    expect(t.deltaKt).toBeCloseTo(5, 3);
    expect(t.stations).toBe(2);
    expect(t.minutes).toBe(25);
    expect(t.label).toBe('Viento subiendo +5kt en 25 min');
  });

  it("a spot's own station counts at any distance", () => {
    const far: TrendStation[] = [
      { id: 'own_far', distKm: 9, preferred: true },
      { id: 'near', distKm: 3, preferred: false },
    ];
    const { history, current } = inputs({ own_far: ramp('own_far', 2, 8), near: ramp('near', 2, 7) });
    expect(analyzeSpotWindTrend(far, history, current, 6)?.signal).toBe('building');
  });

  it('an excluded anemometer never moves the trend', () => {
    const near: TrendStation[] = [
      { id: 'broken', distKm: 1, preferred: false },
      { id: 'ok', distKm: 2, preferred: false },
    ];
    const { history, current } = inputs({ broken: ramp('broken', 2, 17), ok: ramp('ok', 2, 6) });
    expect(analyzeSpotWindTrend(near, history, current, 6, (id) => id === 'broken')).toBeNull();
  });

  it('two near stations dropping: a falling trend', () => {
    const near: TrendStation[] = [
      { id: 'a', distKm: 1, preferred: false },
      { id: 'b', distKm: 2, preferred: false },
    ];
    const { history, current } = inputs({ a: ramp('a', 12, 6), b: ramp('b', 10, 6) });
    const t = analyzeSpotWindTrend(near, history, current, 6)!;
    expect(t.signal).toBe('dropping');
    expect(t.label).toBe('Viento bajando 5kt en 25 min');
  });

  it('stations disagreeing (one up, one down) give no trend', () => {
    const near: TrendStation[] = [
      { id: 'a', distKm: 1, preferred: false },
      { id: 'b', distKm: 2, preferred: false },
    ];
    const { history, current } = inputs({ a: ramp('a', 2, 8), b: ramp('b', 10, 4) });
    expect(analyzeSpotWindTrend(near, history, current, 6)).toBeNull();
  });
});
