import { describe, it, expect } from 'vitest';
import {
  tideCoefficient,
  coefCategory,
  estimateStormSurge,
  findNextTide,
  nextAmplitude,
  tideTickerLabel,
  shouldShowTideAlert,
  peakAmplitude,
  describeTideStrength,
  COEF_TICKER_THRESHOLD,
  SURGE_TICKER_THRESHOLD_M,
} from './tideAlertService';
import type { TidePoint } from '../api/tideClient';

describe('tideCoefficient', () => {
  it('null on invalid input', () => {
    expect(tideCoefficient(null)).toBeNull();
    expect(tideCoefficient(undefined)).toBeNull();
    expect(tideCoefficient(0)).toBeNull();
    expect(tideCoefficient(-1)).toBeNull();
    expect(tideCoefficient(NaN)).toBeNull();
  });

  it('amplitude 4.2m → coef 120 (cap)', () => {
    expect(tideCoefficient(4.2)).toBe(120);
  });

  it('amplitude 5.0m clamped to 120', () => {
    expect(tideCoefficient(5.0)).toBe(120);
  });

  it('amplitude 2.0m → coef ~57 (medium tide)', () => {
    expect(tideCoefficient(2.0)).toBe(57);
  });

  it('amplitude 0.5m clamped to 20', () => {
    expect(tideCoefficient(0.5)).toBe(20);
  });

  it('amplitude 3.5m → coef 100 (vivas)', () => {
    expect(tideCoefficient(3.5)).toBe(100);
  });
});

describe('coefCategory', () => {
  it('null on invalid', () => {
    expect(coefCategory(null)).toBeNull();
    expect(coefCategory(undefined)).toBeNull();
  });

  it('< 45 → muertas', () => {
    expect(coefCategory(20)).toBe('muertas');
    expect(coefCategory(44)).toBe('muertas');
  });

  it('45-69 → medias', () => {
    expect(coefCategory(45)).toBe('medias');
    expect(coefCategory(69)).toBe('medias');
  });

  it('70-99 → vivas', () => {
    expect(coefCategory(70)).toBe('vivas');
    expect(coefCategory(95)).toBe('vivas');
    expect(coefCategory(99)).toBe('vivas');
  });

  it('>= 100 → extremas', () => {
    expect(coefCategory(100)).toBe('extremas');
    expect(coefCategory(120)).toBe('extremas');
  });
});

describe('estimateStormSurge', () => {
  it('null on invalid', () => {
    expect(estimateStormSurge(null)).toBeNull();
    expect(estimateStormSurge(NaN)).toBeNull();
  });

  it('1013 hPa → 0 surge', () => {
    expect(estimateStormSurge(1013)).toBe(0);
  });

  it('1020 hPa (high pressure) → 0 (no negative surge)', () => {
    expect(estimateStormSurge(1020)).toBe(0);
  });

  it('1000 hPa → 0.13 m surge', () => {
    expect(estimateStormSurge(1000)).toBe(0.13);
  });

  it('980 hPa (deep low) → 0.33 m surge', () => {
    expect(estimateStormSurge(980)).toBe(0.33);
  });
});

describe('findNextTide', () => {
  const points: TidePoint[] = [
    { time: '03:15', height: 0.4, type: 'low' },
    { time: '09:30', height: 3.8, type: 'high' },
    { time: '15:45', height: 0.6, type: 'low' },
    { time: '22:00', height: 3.5, type: 'high' },
  ];

  it('returns next high after now', () => {
    const result = findNextTide(points, new Date(2026, 4, 4, 7, 0));
    expect(result).not.toBeNull();
    expect(result!.point.time).toBe('09:30');
    expect(result!.isRising).toBe(true);
  });

  it('returns next low after high', () => {
    const result = findNextTide(points, new Date(2026, 4, 4, 12, 0));
    expect(result!.point.time).toBe('15:45');
    expect(result!.isRising).toBe(false);
  });

  it('returns null when no tides remaining today', () => {
    const result = findNextTide(points, new Date(2026, 4, 4, 23, 0));
    expect(result).toBeNull();
  });
});

describe('nextAmplitude', () => {
  const points: TidePoint[] = [
    { time: '03:15', height: 0.4, type: 'low' },
    { time: '09:30', height: 3.8, type: 'high' },
    { time: '15:45', height: 0.6, type: 'low' },
  ];

  it('returns absolute difference of next two points', () => {
    expect(nextAmplitude(points, new Date(2026, 4, 4, 7, 0))).toBeCloseTo(3.2, 1);
  });

  it('null when fewer than 2 points remain', () => {
    expect(nextAmplitude(points, new Date(2026, 4, 4, 23, 0))).toBeNull();
  });
});

describe('shouldShowTideAlert', () => {
  it('true when coef >= 95', () => {
    expect(shouldShowTideAlert(95, null)).toBe(true);
    expect(shouldShowTideAlert(102, 0)).toBe(true);
  });

  it('true when surge >= 0.2 m even with low coef', () => {
    expect(shouldShowTideAlert(50, 0.25)).toBe(true);
  });

  it('false when both below thresholds', () => {
    expect(shouldShowTideAlert(80, 0.1)).toBe(false);
    expect(shouldShowTideAlert(94, 0.19)).toBe(false);
  });

  it('false when both null', () => {
    expect(shouldShowTideAlert(null, null)).toBe(false);
  });
});

describe('tideTickerLabel', () => {
  const bajamar: TidePoint = { time: '06:34', height: -0.3, type: 'low' };
  const pleamar: TidePoint = { time: '14:20', height: 4.0, type: 'high' };

  it('extremas + bajamar without surge', () => {
    const label = tideTickerLabel(102, bajamar, 0);
    expect(label).toContain('Aguas vivas extremas');
    expect(label).toContain('coef 102');
    expect(label).toContain('bajamar 06:34');
    expect(label).not.toContain('baja presión');
  });

  it('vivas + pleamar with surge note', () => {
    const label = tideTickerLabel(96, pleamar, 0.3);
    expect(label).toContain('Aguas vivas');
    expect(label).not.toContain('extremas');
    expect(label).toContain('pleamar 14:20');
    expect(label).toContain('+0.3m');
    expect(label).toContain('baja presión');
  });

  it('omits surge note when below threshold', () => {
    const label = tideTickerLabel(100, bajamar, 0.1);
    expect(label).not.toContain('baja presión');
  });
});

describe('thresholds — public constants', () => {
  it('COEF_TICKER_THRESHOLD = 95 (extremas band lower bound)', () => {
    expect(COEF_TICKER_THRESHOLD).toBe(95);
  });

  it('SURGE_TICKER_THRESHOLD_M = 0.2', () => {
    expect(SURGE_TICKER_THRESHOLD_M).toBe(0.2);
  });
});

describe('peakAmplitude', () => {
  it('returns the largest consecutive high/low difference', () => {
    const points: TidePoint[] = [
      { time: '03:15', height: 0.4, type: 'low' },
      { time: '09:30', height: 3.8, type: 'high' },
      { time: '15:45', height: 0.6, type: 'low' },
    ];
    expect(peakAmplitude(points)).toBeCloseTo(3.4, 5); // 3.8 - 0.4
  });

  it('null when fewer than 2 points', () => {
    expect(peakAmplitude([])).toBeNull();
    expect(peakAmplitude([{ time: '06:00', height: 2, type: 'high' }])).toBeNull();
  });

  it('null when all heights equal (no movement)', () => {
    expect(peakAmplitude([
      { time: '06:00', height: 2, type: 'high' },
      { time: '12:00', height: 2, type: 'low' },
    ])).toBeNull();
  });
});

describe('describeTideStrength', () => {
  it('null when amplitude invalid', () => {
    expect(describeTideStrength(null)).toBeNull();
    expect(describeTideStrength(0)).toBeNull();
  });

  it('spring 3.6 m → muy viva (extremas) + seasonal peak', () => {
    const s = describeTideStrength(3.6)!;
    expect(s.category).toBe('extremas');
    expect(s.label).toBe('Marea muy viva');
    expect(s.isSeasonalPeak).toBe(true);
    expect(s.coef).toBeGreaterThanOrEqual(100);
    expect(s.strength).toBeGreaterThan(0.8);
    expect(s.casual).toMatch(/baja/i);
  });

  it('strong-but-not-extreme 3.4 m → viva, not seasonal peak', () => {
    const s = describeTideStrength(3.4)!;
    expect(s.category).toBe('vivas');
    expect(s.label).toBe('Marea viva');
    expect(s.isSeasonalPeak).toBe(false);
  });

  it('typical 2.0 m → media', () => {
    expect(describeTideStrength(2.0)!.label).toBe('Marea media');
  });

  it('neap 0.9 m → muerta, low strength', () => {
    const s = describeTideStrength(0.9)!;
    expect(s.label).toBe('Marea muerta');
    expect(s.strength).toBeLessThan(0.2);
  });

  it('strength stays within 0-1', () => {
    expect(describeTideStrength(5.0)!.strength).toBeLessThanOrEqual(1);
    expect(describeTideStrength(0.5)!.strength).toBeGreaterThanOrEqual(0);
  });
});
