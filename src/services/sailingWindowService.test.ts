import { describe, it, expect } from 'vitest';
import { scoreHourForSpot, findSailingWindows } from './sailingWindowService';
import type { HourlyForecast } from '../types/forecast';
import type { SailingSpot } from '../config/spots';

// ── Helpers ──────────────────────────────────────────────────

function makeHour(overrides: Partial<HourlyForecast> = {}): HourlyForecast {
  return {
    time: new Date('2026-03-19T14:00:00'),
    temperature: 20,
    humidity: 60,
    windSpeed: 7, // ~14kt
    windDirection: 225, // SW
    windGusts: 9,
    precipitation: 0,
    precipProbability: 0,
    cloudCover: 30,
    pressure: 1013,
    isDay: true,
    shortwaveRadiation: 400,
    cape: null,
    boundaryLayerHeight: null,
    visibility: 20000,
    ...overrides,
  };
}

const riasSpot: SailingSpot = {
  id: 'cesantes' as any,
  name: 'Cesantes',
  lat: 42.29,
  lon: -8.65,
  description: 'Test spot',
  sectorId: 'rias',
  thermalDetection: false,
  waveRelevance: 'moderate',
  windPatterns: [{ direction: 225, name: 'SW', type: 'nortada' as any }],
  hardGates: { maxWindKt: 30, maxWaveHeight: 2.5 },
  webcams: [],
};

// ── scoreHourForSpot ─────────────────────────────────────────

describe('scoreHourForSpot (wind-dominant)', () => {
  it('scores calm wind as poor', () => {
    const hour = makeHour({ windSpeed: 0.5 }); // ~1kt
    const result = scoreHourForSpot(hour, riasSpot);
    expect(result.verdict).toBe('poor');
    expect(result.score).toBeLessThan(35);
    expect(result.windKt).toBeLessThanOrEqual(1);
  });

  it('scores ideal wind (14-18kt) as good', () => {
    const hour = makeHour({ windSpeed: 7.7 }); // ~15kt
    const result = scoreHourForSpot(hour, riasSpot);
    expect(result.verdict).toBe('good');
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it('scores moderate wind (8-12kt) as marginal', () => {
    const hour = makeHour({ windSpeed: 5 }); // ~10kt
    const result = scoreHourForSpot(hour, riasSpot);
    expect(result.verdict).toBe('marginal');
    expect(result.score).toBeGreaterThanOrEqual(35);
    expect(result.score).toBeLessThan(60);
  });

  it('penalizes high precipitation', () => {
    const clear = scoreHourForSpot(makeHour({ precipProbability: 0 }), riasSpot);
    const rainy = scoreHourForSpot(makeHour({ precipProbability: 80 }), riasSpot);
    expect(rainy.score).toBeLessThan(clear.score);
  });

  it('penalizes excessive gusts', () => {
    const calm = scoreHourForSpot(makeHour({ windSpeed: 7, windGusts: 8 }), riasSpot);
    const gusty = scoreHourForSpot(makeHour({ windSpeed: 7, windGusts: 16 }), riasSpot);
    expect(gusty.score).toBeLessThan(calm.score);
  });

  it('gives daylight bonus', () => {
    const day = scoreHourForSpot(makeHour({ isDay: true }), riasSpot);
    const night = scoreHourForSpot(makeHour({ isDay: false }), riasSpot);
    expect(day.score).toBeGreaterThan(night.score);
  });

  it('caps score at max wind hard gate', () => {
    const hour = makeHour({ windSpeed: 18 }); // ~35kt, over maxWindKt=30
    const result = scoreHourForSpot(hour, riasSpot);
    expect(result.score).toBeLessThanOrEqual(5);
  });

  it('clamps score between 0-100', () => {
    const result = scoreHourForSpot(makeHour({ windSpeed: 7.7 }), riasSpot);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ── findSailingWindows ───────────────────────────────────────

describe('findSailingWindows', () => {
  function makeScores(scores: number[]): ReturnType<typeof scoreHourForSpot>[] {
    return scores.map((s, i) => ({
      time: new Date(`2026-03-19T${String(10 + i).padStart(2, '0')}:00:00`),
      score: s,
      windKt: 12,
      windDir: 225,
      verdict: (s >= 60 ? 'good' : s >= 35 ? 'marginal' : 'poor') as any,
      label: '12kt SW',
    }));
  }

  it('finds a window of consecutive good hours', () => {
    // 10h:poor, 11h-14h:good, 15h:poor
    const scores = makeScores([20, 65, 70, 75, 65, 20]);
    const windows = findSailingWindows(scores);
    expect(windows.length).toBe(1);
    expect(windows[0].hours).toBe(4);
    expect(windows[0].verdict).toBe('good');
  });

  it('rejects windows shorter than MIN_WINDOW_HOURS', () => {
    // Only 1 good hour
    const scores = makeScores([20, 65, 20, 20, 20, 20]);
    const windows = findSailingWindows(scores);
    expect(windows.length).toBe(0);
  });

  it('merges windows separated by 1 poor hour', () => {
    // 2 good, 1 poor, 2 good → merged into 1 window of 5h
    const scores = makeScores([65, 70, 20, 65, 70, 20]);
    const windows = findSailingWindows(scores);
    expect(windows.length).toBe(1);
    expect(windows[0].hours).toBeGreaterThanOrEqual(4);
  });

  it('returns empty for all poor hours', () => {
    const scores = makeScores([10, 15, 20, 10, 5, 10]);
    const windows = findSailingWindows(scores);
    expect(windows.length).toBe(0);
  });

  it('identifies best window by avgScore', () => {
    // Window 1: 11-12h marginal, Window 2: 14-15h good
    const scores = makeScores([20, 40, 45, 20, 75, 80, 70, 20]);
    const windows = findSailingWindows(scores);
    expect(windows.length).toBeGreaterThanOrEqual(1);
    const best = windows.reduce((a, b) => a.avgScore > b.avgScore ? a : b);
    expect(best.avgScore).toBeGreaterThanOrEqual(60);
  });
});
