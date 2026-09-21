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
  scaleGustToSpot,
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
    expect(windSpeedColor(5)).toBe('#84cc16');
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
  it('returns dark violet for severe storm 40-50kt', () => {
    expect(windSpeedColor(22)).toBe('#7c3aed');
  });
  it('returns near-black for hurricane 50+kt', () => {
    expect(windSpeedColor(27)).toBe('#1e1b4b');
  });
});

describe('scaleGustToSpot — the gust travels with the mean', () => {
  const CAP = 45;

  it('scales the gust realistically above the effective mean without absurd multiplication', () => {
    // Station 5kt mean / 10kt gust, boosted to 14kt at the spot.
    // Instead of multiplying 10 * 2.8 = 28kt (absurd), it scales to realistic 18kt (~1.25-1.35x mean).
    expect(scaleGustToSpot(10, 5, 14, CAP)).toBe(18);
  });

  it('never leaves a gust below the mean it accompanies — the bug this closes', () => {
    // What the popup actually printed: "Viento ~14 kt" above "Racha 10 kt".
    const scaled = scaleGustToSpot(10, 5, 14, CAP);
    expect(scaled).toBeGreaterThanOrEqual(14);
  });

  it('leaves the reading untouched when there is no boost', () => {
    expect(scaleGustToSpot(12, 8, 8, CAP)).toBe(12);
  });

  it('refuses to shrink a gust when the spot reads calmer than its stations', () => {
    // A factor below 1 would mean scaling a measured gust DOWN, which is
    // inventing calm — the opposite of what the caps exist for.
    expect(scaleGustToSpot(12, 10, 6, CAP)).toBe(12);
  });

  it('respects both the realistic marine ceiling and the hard cap', () => {
    // A 30kt raw gust on a 5kt station with a 15kt spot mean must NOT scale to 90kt.
    // Instead it is capped by the realistic marine ceiling (15 * 1.4 = 21kt).
    expect(scaleGustToSpot(30, 5, 15, CAP)).toBe(21);
    // And if an explicit lower cap is provided, it is strictly obeyed:
    expect(scaleGustToSpot(30, 5, 15, 18)).toBe(18);
  });

  it('passes null through, because no gust is not a gust of zero', () => {
    expect(scaleGustToSpot(null, 5, 14, CAP)).toBeNull();
  });

  it('survives a zero or nonsense mean instead of dividing by it', () => {
    // Dead calm at the stations with a gust recorded is unusual but real, and
    // must not produce Infinity.
    expect(scaleGustToSpot(9, 0, 14, CAP)).toBe(9);
    expect(scaleGustToSpot(9, NaN, 14, CAP)).toBe(9);
    expect(scaleGustToSpot(9, 5, NaN, CAP)).toBe(9);
  });
});
