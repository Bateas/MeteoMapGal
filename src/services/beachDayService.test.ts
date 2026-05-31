/**
 * Tests for beachDayService — casual "¿buen día de playa?" verdict.
 * Coarse heuristic: assert the contract (gating, rain override, ordering,
 * water-temp weighting) rather than exact scores.
 */
import { describe, it, expect } from 'vitest';
import { assessBeachDay, type BeachDayInputs } from './beachDayService';

const base: BeachDayInputs = {
  cloudCoverPct: null, windKt: null, airTempC: null, waterTempC: null,
  rainingNow: false, rainSoon: false,
};
const opts = (o: Partial<BeachDayInputs>): BeachDayInputs => ({ ...base, ...o });

describe('assessBeachDay — gating', () => {
  it('returns unknown with fewer than 2 known signals', () => {
    expect(assessBeachDay(opts({ cloudCoverPct: 10 })).verdict).toBe('unknown');
    expect(assessBeachDay(base).verdict).toBe('unknown');
  });

  it('commits to a verdict with 2+ signals', () => {
    expect(assessBeachDay(opts({ cloudCoverPct: 10, airTempC: 27 })).verdict).not.toBe('unknown');
  });
});

describe('assessBeachDay — rain override', () => {
  it('raining now → poor regardless of sun/heat', () => {
    const r = assessBeachDay(opts({ cloudCoverPct: 5, airTempC: 30, waterTempC: 22, rainingNow: true }));
    expect(r.verdict).toBe('poor');
    expect(r.summary).toMatch(/lloviendo/i);
    expect(r.reasons[0]).toMatch(/[Ll]loviendo/);
  });

  it('rain soon downgrades a would-be great day to ok', () => {
    const dry = assessBeachDay(opts({ cloudCoverPct: 5, airTempC: 28, windKt: 4, waterTempC: 21 }));
    expect(dry.verdict).toBe('great');
    const soon = assessBeachDay(opts({ cloudCoverPct: 5, airTempC: 28, windKt: 4, waterTempC: 21, rainSoon: true }));
    expect(soon.verdict).toBe('ok');
    expect(soon.reasons).toContain('Posible lluvia');
  });
});

describe('assessBeachDay — verdicts', () => {
  it('sunny, warm, calm, warm water → great', () => {
    const r = assessBeachDay(opts({ cloudCoverPct: 10, airTempC: 28, windKt: 5, waterTempC: 21 }));
    expect(r.verdict).toBe('great');
    expect(r.summary).toBe('Buen día de playa');
    expect(r.reasons).toContain('Sol pleno');
  });

  it('overcast, cold, windy → poor', () => {
    const r = assessBeachDay(opts({ cloudCoverPct: 95, airTempC: 14, windKt: 24, waterTempC: 13 }));
    expect(r.verdict).toBe('poor');
    expect(r.summary).toBe('Mal día de playa');
    expect(r.reasons).toContain('Ventoso — arena volando');
  });

  it('mixed conditions land in the regular band', () => {
    const r = assessBeachDay(opts({ cloudCoverPct: 50, airTempC: 20, windKt: 12, waterTempC: 16 }));
    expect(r.verdict).toBe('ok');
  });
});

describe('assessBeachDay — water temp weighting (Galician Atlantic)', () => {
  it('cold water pulls a sunny warm day down vs warm water', () => {
    const warm = assessBeachDay(opts({ cloudCoverPct: 10, airTempC: 27, windKt: 5, waterTempC: 21 }));
    const cold = assessBeachDay(opts({ cloudCoverPct: 10, airTempC: 27, windKt: 5, waterTempC: 13 }));
    expect(cold.score).toBeLessThan(warm.score);
    expect(cold.reasons.some((x) => /muy fría/i.test(x))).toBe(true);
  });
});

describe('assessBeachDay — output hygiene', () => {
  it('caps reasons at 4 chips', () => {
    const r = assessBeachDay(opts({ cloudCoverPct: 10, airTempC: 28, windKt: 5, waterTempC: 21, rainSoon: true }));
    expect(r.reasons.length).toBeLessThanOrEqual(4);
  });

  it('keeps score within 0-100', () => {
    const hi = assessBeachDay(opts({ cloudCoverPct: 0, airTempC: 35, windKt: 0, waterTempC: 25 }));
    const lo = assessBeachDay(opts({ cloudCoverPct: 100, airTempC: 5, windKt: 40, waterTempC: 8 }));
    expect(hi.score).toBeLessThanOrEqual(100);
    expect(lo.score).toBeGreaterThanOrEqual(0);
  });
});
