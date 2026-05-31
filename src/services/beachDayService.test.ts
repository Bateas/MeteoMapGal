/**
 * Tests for beachDayService — casual "¿buen día de playa?" verdict, calibrated
 * to Galician reality: cold water + ~22° coast is a fine day, NOT a bad one.
 * A day is only "malo" via hard gates (rain now / fog / air <20° / wind ≥25kt).
 */
import { describe, it, expect } from 'vitest';
import { assessBeachDay, type BeachDayInputs } from './beachDayService';

const base: BeachDayInputs = {
  cloudCoverPct: null, windKt: null, airTempC: null, waterTempC: null,
  rainingNow: false, rainSoon: false, foggy: false,
};
const opts = (o: Partial<BeachDayInputs>): BeachDayInputs => ({ ...base, ...o });

describe('assessBeachDay — gating', () => {
  it('returns unknown with fewer than 2 numeric signals', () => {
    expect(assessBeachDay(opts({ cloudCoverPct: 10 })).verdict).toBe('unknown');
    expect(assessBeachDay(base).verdict).toBe('unknown');
  });

  it('commits to a verdict with 2+ signals', () => {
    expect(assessBeachDay(opts({ cloudCoverPct: 10, airTempC: 24 })).verdict).not.toBe('unknown');
  });
});

describe('assessBeachDay — hard "mal día" gates', () => {
  it('raining now → poor (even with thin data)', () => {
    const r = assessBeachDay(opts({ rainingNow: true }));
    expect(r.verdict).toBe('poor');
    expect(r.summary).toBe('Mal día de playa');
    expect(r.reasons[0]).toMatch(/[Ll]loviendo/);
  });

  it('fog / poor visibility → poor (even with thin data)', () => {
    const r = assessBeachDay(opts({ foggy: true }));
    expect(r.verdict).toBe('poor');
    expect(r.reasons[0]).toMatch(/[Nn]iebla/);
  });

  it('air below 20°C → poor', () => {
    const r = assessBeachDay(opts({ cloudCoverPct: 0, airTempC: 18, windKt: 5, waterTempC: 18 }));
    expect(r.verdict).toBe('poor');
    expect(r.reasons[0]).toMatch(/[Ff]río/);
  });

  it('very strong wind (≥25kt) → poor', () => {
    const r = assessBeachDay(opts({ cloudCoverPct: 0, airTempC: 26, windKt: 27, waterTempC: 19 }));
    expect(r.verdict).toBe('poor');
    expect(r.reasons[0]).toMatch(/viento/i);
  });
});

describe('assessBeachDay — Galician normal days are NOT bad', () => {
  it('cold water (18°) + warm coast (22°) + sun + calm → at least a good day', () => {
    const r = assessBeachDay(opts({ cloudCoverPct: 10, airTempC: 22, windKt: 6, waterTempC: 18 }));
    expect(r.verdict).not.toBe('poor');
    expect(['ok', 'great']).toContain(r.verdict);
  });

  it('cold water never drags the verdict to poor on its own', () => {
    const r = assessBeachDay(opts({ cloudCoverPct: 20, airTempC: 23, windKt: 8, waterTempC: 13 }));
    expect(r.verdict).not.toBe('poor');
    expect(r.reasons.some((x) => /[Aa]gua fría/.test(x))).toBe(true);
  });

  it('overcast cool-ish (but ≥20°) breezy day is a "buen día", not malo', () => {
    const r = assessBeachDay(opts({ cloudCoverPct: 70, airTempC: 21, windKt: 14, waterTempC: 16 }));
    expect(r.verdict).toBe('ok');
    expect(r.summary).toBe('Buen día de playa');
  });
});

describe('assessBeachDay — ideal vs good', () => {
  it('sunny, hot, calm → ideal (even with cold Galician water)', () => {
    const r = assessBeachDay(opts({ cloudCoverPct: 5, airTempC: 28, windKt: 5, waterTempC: 18 }));
    expect(r.verdict).toBe('great');
    expect(r.summary).toBe('Día de playa ideal');
    expect(r.reasons).toContain('Sol');
  });

  it('mild sunny day stays "buen día" (not ideal)', () => {
    const r = assessBeachDay(opts({ cloudCoverPct: 40, airTempC: 22, windKt: 12, waterTempC: 18 }));
    expect(r.verdict).toBe('ok');
  });
});

describe('assessBeachDay — rain soon', () => {
  it('downgrades a would-be ideal day to good and adds a caveat (but not poor)', () => {
    const dry = assessBeachDay(opts({ cloudCoverPct: 5, airTempC: 28, windKt: 5, waterTempC: 20 }));
    expect(dry.verdict).toBe('great');
    const soon = assessBeachDay(opts({ cloudCoverPct: 5, airTempC: 28, windKt: 5, waterTempC: 20, rainSoon: true }));
    expect(soon.verdict).toBe('ok');
    expect(soon.reasons).toContain('Posible lluvia');
  });
});

describe('assessBeachDay — output hygiene', () => {
  it('caps reasons at 4 chips', () => {
    const r = assessBeachDay(opts({ cloudCoverPct: 10, airTempC: 28, windKt: 5, waterTempC: 21, rainSoon: true }));
    expect(r.reasons.length).toBeLessThanOrEqual(4);
  });

  it('keeps score within 0-100', () => {
    const hi = assessBeachDay(opts({ cloudCoverPct: 0, airTempC: 35, windKt: 0, waterTempC: 25 }));
    expect(hi.score).toBeLessThanOrEqual(100);
    expect(hi.score).toBeGreaterThanOrEqual(0);
  });
});
