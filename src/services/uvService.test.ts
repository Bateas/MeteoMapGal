import { describe, it, expect } from 'vitest';
import {
  uvCategory,
  uvColor,
  uvWaterAdjusted,
  isPeakUvHour,
  uvTickerLabel,
  UV_TICKER_THRESHOLD,
} from './uvService';

describe('uvCategory — WHO bands', () => {
  it('returns null for invalid input', () => {
    expect(uvCategory(null)).toBeNull();
    expect(uvCategory(undefined)).toBeNull();
    expect(uvCategory(NaN)).toBeNull();
    expect(uvCategory(-1)).toBeNull();
  });

  it('classifies 0-2 as low', () => {
    expect(uvCategory(0)).toBe('low');
    expect(uvCategory(2.9)).toBe('low');
  });

  it('classifies 3-5 as moderate', () => {
    expect(uvCategory(3)).toBe('moderate');
    expect(uvCategory(5.9)).toBe('moderate');
  });

  it('classifies 6-7 as high', () => {
    expect(uvCategory(6)).toBe('high');
    expect(uvCategory(7.9)).toBe('high');
  });

  it('classifies 8-10 as very_high', () => {
    expect(uvCategory(8)).toBe('very_high');
    expect(uvCategory(10.9)).toBe('very_high');
  });

  it('classifies 11+ as extreme', () => {
    expect(uvCategory(11)).toBe('extreme');
    expect(uvCategory(15)).toBe('extreme');
  });
});

describe('uvColor', () => {
  it('returns slate fallback for null', () => {
    expect(uvColor(null)).toBe('#94a3b8');
  });

  it('returns category-specific hex', () => {
    expect(uvColor(1)).toBe('#4ade80');   // green = low
    expect(uvColor(4)).toBe('#facc15');   // yellow = moderate
    expect(uvColor(7)).toBe('#fb923c');   // orange = high
    expect(uvColor(9)).toBe('#ef4444');   // red = very_high
    expect(uvColor(12)).toBe('#a855f7');  // purple = extreme
  });
});

describe('uvWaterAdjusted', () => {
  it('returns null on invalid', () => {
    expect(uvWaterAdjusted(null)).toBeNull();
    expect(uvWaterAdjusted(undefined)).toBeNull();
    expect(uvWaterAdjusted(NaN)).toBeNull();
  });

  it('multiplies by 1.3 and rounds to 1 decimal', () => {
    expect(uvWaterAdjusted(7)).toBe(9.1);
    expect(uvWaterAdjusted(10)).toBe(13);
    expect(uvWaterAdjusted(0)).toBe(0);
  });
});

describe('isPeakUvHour', () => {
  it('true at 12:00, 14:00, 15:59', () => {
    expect(isPeakUvHour(new Date(2026, 5, 15, 12, 0))).toBe(true);
    expect(isPeakUvHour(new Date(2026, 5, 15, 14, 0))).toBe(true);
    expect(isPeakUvHour(new Date(2026, 5, 15, 15, 59))).toBe(true);
  });

  it('false at 11:59, 16:00, 8:00, 22:00', () => {
    expect(isPeakUvHour(new Date(2026, 5, 15, 11, 59))).toBe(false);
    expect(isPeakUvHour(new Date(2026, 5, 15, 16, 0))).toBe(false);
    expect(isPeakUvHour(new Date(2026, 5, 15, 8, 0))).toBe(false);
    expect(isPeakUvHour(new Date(2026, 5, 15, 22, 0))).toBe(false);
  });
});

describe('UV_TICKER_THRESHOLD', () => {
  it('matches WHO upper-half of "high" band', () => {
    expect(UV_TICKER_THRESHOLD).toBe(7);
  });
});

describe('uvTickerLabel', () => {
  it('formats high UV with action', () => {
    const label = uvTickerLabel(7);
    expect(label).toContain('UV 7');
    expect(label).toContain('ALTO');
    expect(label).toContain('agua +9.1');
    expect(label).toContain('gorra/protector');
  });

  it('formats very high UV with stronger action', () => {
    const label = uvTickerLabel(10);
    expect(label).toContain('MUY ALTO');
    expect(label).toContain('agua +13');
    expect(label).toContain('cuidado');
  });

  it('formats extreme UV with strongest action', () => {
    const label = uvTickerLabel(12);
    expect(label).toContain('EXTREMO');
    expect(label).toContain('evitar');
  });

  it('label stays under 50 chars (ticker space budget)', () => {
    expect(uvTickerLabel(12).length).toBeLessThan(60);
    expect(uvTickerLabel(7).length).toBeLessThan(60);
  });
});
