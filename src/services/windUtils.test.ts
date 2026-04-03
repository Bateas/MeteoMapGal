import { describe, it, expect } from 'vitest';
import {
  degreesToCardinal,
  windArrowRotation,
  msToKnots,
  formatWindSpeed,
  angleDifference,
  averageWindDirection,
  isDirectionInRange,
  windSpeedColor,
} from './windUtils';

describe('degreesToCardinal', () => {
  it('converts 0° to N', () => expect(degreesToCardinal(0)).toBe('N'));
  it('converts 360° to N', () => expect(degreesToCardinal(360)).toBe('N'));
  it('converts 90° to E', () => expect(degreesToCardinal(90)).toBe('E'));
  it('converts 180° to S', () => expect(degreesToCardinal(180)).toBe('S'));
  it('converts 270° to W', () => expect(degreesToCardinal(270)).toBe('W'));
  it('converts 45° to NE', () => expect(degreesToCardinal(45)).toBe('NE'));
  it('converts 225° to SW', () => expect(degreesToCardinal(225)).toBe('SW'));
  it('handles negative values', () => expect(degreesToCardinal(-90)).toBe('W'));
});

describe('windArrowRotation', () => {
  it('adds 180° (arrow points where wind goes TO)', () => {
    expect(windArrowRotation(0)).toBe(180);
    expect(windArrowRotation(180)).toBe(0);
    expect(windArrowRotation(270)).toBe(90);
  });
  it('wraps around 360', () => {
    expect(windArrowRotation(350)).toBe(170);
  });
});

describe('msToKnots', () => {
  it('converts 1 m/s to ~1.94 kt', () => {
    expect(msToKnots(1)).toBeCloseTo(1.94384, 3);
  });
  it('converts 0 m/s to 0 kt', () => {
    expect(msToKnots(0)).toBe(0);
  });
  it('converts 10 m/s to ~19.4 kt', () => {
    expect(msToKnots(10)).toBeCloseTo(19.4384, 2);
  });
});

describe('formatWindSpeed', () => {
  it('formats null as --', () => {
    expect(formatWindSpeed(null)).toBe('--');
  });
  it('formats 5 m/s as knots', () => {
    const result = formatWindSpeed(5);
    expect(result).toMatch(/^\d+\.\d kt$/);
    expect(result).toBe('9.7 kt');
  });
});

describe('angleDifference', () => {
  it('returns 0 for same angles', () => {
    expect(angleDifference(90, 90)).toBe(0);
  });
  it('returns difference for close angles', () => {
    expect(angleDifference(10, 30)).toBe(20);
  });
  it('handles wraparound (350° vs 10° = 20°)', () => {
    expect(angleDifference(350, 10)).toBe(20);
  });
  it('max is 180°', () => {
    expect(angleDifference(0, 180)).toBe(180);
  });
  it('is symmetric', () => {
    expect(angleDifference(30, 350)).toBe(angleDifference(350, 30));
  });
});

describe('averageWindDirection', () => {
  it('returns null for empty array', () => {
    expect(averageWindDirection([])).toBeNull();
  });
  it('returns null for all-null array', () => {
    expect(averageWindDirection([null, null])).toBeNull();
  });
  it('returns same value for single direction', () => {
    expect(averageWindDirection([180])).toBeCloseTo(180, 0);
  });
  it('averages opposite directions to NaN-safe result', () => {
    // N + S → could be E or W, atan2 decides
    const result = averageWindDirection([0, 180]);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(360);
  });
  it('averages NE directions correctly', () => {
    const result = averageWindDirection([40, 50]);
    expect(result).toBeCloseTo(45, 0);
  });
  it('handles wraparound (350° + 10° → 0°)', () => {
    const result = averageWindDirection([350, 10]);
    // Should be close to 0 (north)
    expect(result! < 10 || result! > 350).toBe(true);
  });
  it('filters null values', () => {
    const result = averageWindDirection([90, null, 90]);
    expect(result).toBeCloseTo(90, 0);
  });
});

describe('isDirectionInRange', () => {
  it('matches normal range (200-290)', () => {
    expect(isDirectionInRange(250, { from: 200, to: 290 })).toBe(true);
    expect(isDirectionInRange(200, { from: 200, to: 290 })).toBe(true);
    expect(isDirectionInRange(290, { from: 200, to: 290 })).toBe(true);
  });
  it('rejects outside normal range', () => {
    expect(isDirectionInRange(100, { from: 200, to: 290 })).toBe(false);
    expect(isDirectionInRange(300, { from: 200, to: 290 })).toBe(false);
  });
  it('handles wraparound range (315-45 through north)', () => {
    expect(isDirectionInRange(0, { from: 315, to: 45 })).toBe(true);
    expect(isDirectionInRange(350, { from: 315, to: 45 })).toBe(true);
    expect(isDirectionInRange(30, { from: 315, to: 45 })).toBe(true);
  });
  it('rejects outside wraparound range', () => {
    expect(isDirectionInRange(180, { from: 315, to: 45 })).toBe(false);
    expect(isDirectionInRange(90, { from: 315, to: 45 })).toBe(false);
  });
  it('normalizes negative/overflow directions', () => {
    expect(isDirectionInRange(720, { from: 0, to: 90 })).toBe(true);
    expect(isDirectionInRange(-90, { from: 250, to: 290 })).toBe(true);
  });
});

describe('windSpeedColor — simplified scale (0-6kt = one blue)', () => {
  it('returns slate for calm/null (<0.5 m/s)', () => {
    expect(windSpeedColor(null)).toBe('#64748b');
    expect(windSpeedColor(0.3)).toBe('#64748b');
  });
  it('returns sky-400 for all light wind 1-6kt (one blue)', () => {
    expect(windSpeedColor(1)).toBe('#38bdf8');
    expect(windSpeedColor(2)).toBe('#38bdf8');
  });
  it('returns green for gentle wind 6-9kt', () => {
    expect(windSpeedColor(4)).toBe('#22c55e');
  });
  it('returns lime for moderate wind 9-13kt', () => {
    expect(windSpeedColor(5)).toBe('#a3e635');
  });
  it('returns yellow for fresh wind 13-18kt', () => {
    expect(windSpeedColor(7)).toBe('#eab308');
  });
  it('returns orange for strong wind 18-23kt', () => {
    expect(windSpeedColor(10)).toBe('#f97316');
  });
  it('returns red for gale 23-30kt', () => {
    expect(windSpeedColor(13)).toBe('#ef4444');
  });
  it('returns violet for extreme 30-40kt', () => {
    expect(windSpeedColor(17)).toBe('#a855f7');
  });
  it('returns dark violet for storm 40+kt', () => {
    expect(windSpeedColor(22)).toBe('#7c3aed');
  });
});
