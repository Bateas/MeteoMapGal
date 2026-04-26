/**
 * Tests for rainAlerts builder — emits UnifiedAlert[] from forecast data.
 *
 * Critical path: feeds Telegram alert pipeline + frontend AlertPanel for
 * incoming precipitation. Pure function, no API calls.
 *
 * S123: third test file in src/services/alerts/.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildRainAlerts } from './rainAlerts';
import type { HourlyForecast } from '../../types/forecast';

// ── Time setup — fix "now" so etaHours math is deterministic ─

const FIXED_NOW = new Date('2026-04-26T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── HourlyForecast builder ───────────────────────────────────

function hour(over: Partial<HourlyForecast> & { offsetH: number }): HourlyForecast {
  const t = new Date(FIXED_NOW.getTime() + over.offsetH * 3600_000);
  return {
    time: t,
    temperature: 18,
    humidity: 70,
    windSpeed: 5,
    windDirection: 180,
    windGusts: 8,
    precipitation: 0,
    precipProbability: 0,
    cloudCover: 30,
    pressure: 1015,
    solarRadiation: null,
    cape: null,
    boundaryLayerHeight: null,
    visibility: 20000,
    liftedIndex: null,
    cin: null,
    snowLevel: null,
    skyState: null,
    isDay: true,
    ...over,
  };
}

// ── Edge cases ──────────────────────────────────────────────

describe('buildRainAlerts — edge cases', () => {
  it('returns empty for undefined forecast', () => {
    expect(buildRainAlerts(undefined)).toEqual([]);
  });

  it('returns empty for empty array', () => {
    expect(buildRainAlerts([])).toEqual([]);
  });

  it('returns empty when no hour meets MIN_PROB + MIN_PRECIP_MM', () => {
    // 50% prob (below 60) + 1mm precip = no trigger
    const fc = [hour({ offsetH: 1, precipProbability: 50, precipitation: 1.0 })];
    expect(buildRainAlerts(fc)).toEqual([]);
  });

  it('returns empty when prob meets but precip too low (<0.5mm)', () => {
    const fc = [hour({ offsetH: 1, precipProbability: 90, precipitation: 0.3 })];
    expect(buildRainAlerts(fc)).toEqual([]);
  });

  it('skips hours beyond LOOKAHEAD_HOURS (6h)', () => {
    // Rain at +8h is too far — no alert
    const fc = [hour({ offsetH: 8, precipProbability: 90, precipitation: 5 })];
    expect(buildRainAlerts(fc)).toEqual([]);
  });

  it('skips past hours (eta < -0.5)', () => {
    const fc = [
      hour({ offsetH: -2, precipProbability: 90, precipitation: 5 }), // past
    ];
    expect(buildRainAlerts(fc)).toEqual([]);
  });
});

// ── Severity classification ─────────────────────────────────

describe('buildRainAlerts — severity classification', () => {
  it('emits info severity for light rain (≤2mm/h)', () => {
    const fc = [hour({ offsetH: 2, precipProbability: 70, precipitation: 1.5 })];
    const alerts = buildRainAlerts(fc);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('info');
  });

  it('emits high severity for moderate rain (2-5mm/h)', () => {
    const fc = [hour({ offsetH: 2, precipProbability: 70, precipitation: 3.5 })];
    expect(buildRainAlerts(fc)[0].severity).toBe('high');
  });

  it('emits high severity for high probability even with light rain', () => {
    // maxProb > 80 escalates to high
    const fc = [hour({ offsetH: 2, precipProbability: 90, precipitation: 1.5 })];
    expect(buildRainAlerts(fc)[0].severity).toBe('high');
  });

  it('emits critical severity for intense rain (>5mm/h)', () => {
    const fc = [hour({ offsetH: 2, precipProbability: 70, precipitation: 8 })];
    expect(buildRainAlerts(fc)[0].severity).toBe('critical');
  });
});

// ── Score computation ───────────────────────────────────────

describe('buildRainAlerts — score boost rules', () => {
  it('imminent rain (<1h) boosts score +10', () => {
    const fc = [hour({ offsetH: 0.5, precipProbability: 70, precipitation: 1.5 })];
    const alerts = buildRainAlerts(fc);
    // base score for 1.5mm: 30 + (1.5-0.5)*13 = 43, +10 imminent = 53
    expect(alerts[0].score).toBeGreaterThanOrEqual(50);
    expect(alerts[0].urgent).toBe(true); // imminent + not moderate severity
  });

  it('high probability (≥90%) boosts score +5', () => {
    const fc = [hour({ offsetH: 3, precipProbability: 95, precipitation: 1.5 })];
    const alerts = buildRainAlerts(fc);
    // not imminent (>1h) so no +10. Just +5 from 95% prob.
    expect(alerts[0].score).toBeGreaterThan(40);
  });

  it('caps score at 90', () => {
    const fc = [hour({ offsetH: 0.3, precipProbability: 95, precipitation: 50 })];
    expect(buildRainAlerts(fc)[0].score).toBeLessThanOrEqual(90);
  });

  it('score never below 30 for trigger event', () => {
    const fc = [hour({ offsetH: 5, precipProbability: 60, precipitation: 0.5 })];
    expect(buildRainAlerts(fc)[0].score).toBeGreaterThanOrEqual(30);
  });
});

// ── Title content ───────────────────────────────────────────

describe('buildRainAlerts — title formatting', () => {
  it('"Lluvia intensa prevista" for >5mm/h', () => {
    const fc = [hour({ offsetH: 2, precipProbability: 70, precipitation: 8 })];
    expect(buildRainAlerts(fc)[0].title).toContain('intensa');
  });

  it('"Lluvia moderada prevista" for 2-5mm/h', () => {
    const fc = [hour({ offsetH: 2, precipProbability: 70, precipitation: 3 })];
    expect(buildRainAlerts(fc)[0].title).toContain('moderada');
  });

  it('"Lluvia prevista" for ≤2mm/h', () => {
    const fc = [hour({ offsetH: 2, precipProbability: 70, precipitation: 1 })];
    expect(buildRainAlerts(fc)[0].title).toMatch(/^Lluvia prevista/);
  });

  it('"inminente" label when eta <0.5h', () => {
    const fc = [hour({ offsetH: 0.2, precipProbability: 70, precipitation: 1 })];
    expect(buildRainAlerts(fc)[0].title).toContain('inminente');
  });

  it('"<1h" label when 0.5 ≤ eta < 1', () => {
    const fc = [hour({ offsetH: 0.7, precipProbability: 70, precipitation: 1 })];
    expect(buildRainAlerts(fc)[0].title).toContain('<1h');
  });

  it('"~Nh" label when eta ≥1h', () => {
    const fc = [hour({ offsetH: 3, precipProbability: 70, precipitation: 1 })];
    expect(buildRainAlerts(fc)[0].title).toMatch(/~3h/);
  });
});

// ── Detail format ───────────────────────────────────────────

describe('buildRainAlerts — detail formatting', () => {
  it('includes max precip + max prob', () => {
    const fc = [hour({ offsetH: 2, precipProbability: 75, precipitation: 2.3 })];
    const detail = buildRainAlerts(fc)[0].detail;
    expect(detail).toContain('2.3 mm/h');
    expect(detail).toContain('75% prob');
  });

  it('includes total accumulated when multi-hour event', () => {
    const fc = [
      hour({ offsetH: 1, precipProbability: 70, precipitation: 2 }),
      hour({ offsetH: 2, precipProbability: 80, precipitation: 3 }),
      hour({ offsetH: 3, precipProbability: 75, precipitation: 1.5 }),
    ];
    const detail = buildRainAlerts(fc)[0].detail;
    expect(detail).toContain('3h de lluvia');
    expect(detail).toContain('6.5 mm acum'); // 2+3+1.5
  });

  it('omits multi-hour fields for single-hour event', () => {
    const fc = [hour({ offsetH: 2, precipProbability: 70, precipitation: 2 })];
    const detail = buildRainAlerts(fc)[0].detail;
    expect(detail).not.toContain('h de lluvia');
    expect(detail).not.toContain('acum');
  });

  it('includes "desde HH:MM" of first rainy hour', () => {
    const fc = [hour({ offsetH: 3, precipProbability: 70, precipitation: 2 })];
    const detail = buildRainAlerts(fc)[0].detail;
    expect(detail).toMatch(/desde \d{2}:\d{2}/);
  });
});

// ── Confidence ──────────────────────────────────────────────

describe('buildRainAlerts — confidence + alert metadata', () => {
  it('confidence equals max probability (capped at 100)', () => {
    const fc = [hour({ offsetH: 2, precipProbability: 95, precipitation: 2 })];
    expect(buildRainAlerts(fc)[0].confidence).toBe(95);
  });

  it('emits alert with id="rain-forecast" and category="rain"', () => {
    const fc = [hour({ offsetH: 2, precipProbability: 70, precipitation: 1 })];
    const a = buildRainAlerts(fc)[0];
    expect(a.id).toBe('rain-forecast');
    expect(a.category).toBe('rain');
    expect(a.icon).toBe('cloud-rain');
  });
});
