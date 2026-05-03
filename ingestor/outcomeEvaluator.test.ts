/**
 * Tests for outcomeEvaluator pure verdict logic.
 * (DB-bound functions are tested in production via log lines.)
 */
import { describe, it, expect } from 'vitest';
import { computeVerdict, VERDICT_THRESHOLDS } from './outcomeEvaluator';

describe('computeVerdict — active predictions (prob >= 60)', () => {
  it('marks correct when ≥5 strikes', () => {
    expect(computeVerdict({
      predictedProbability: 70,
      observedStrikeCount: 12,
      observedMaxRainGridMm: 0,
      observedMaxRainStationsMm: 0,
    })).toBe(true);
  });

  it('marks correct when grid rain ≥5mm', () => {
    expect(computeVerdict({
      predictedProbability: 80,
      observedStrikeCount: 0,
      observedMaxRainGridMm: 7.5,
      observedMaxRainStationsMm: 0,
    })).toBe(true);
  });

  it('marks correct when station rain ≥5mm (ground truth)', () => {
    expect(computeVerdict({
      predictedProbability: 60,
      observedStrikeCount: 0,
      observedMaxRainGridMm: 1, // grid said dry
      observedMaxRainStationsMm: 12, // station says it poured
    })).toBe(true);
  });

  it('marks incorrect when no strikes and minimal rain', () => {
    expect(computeVerdict({
      predictedProbability: 75,
      observedStrikeCount: 1,
      observedMaxRainGridMm: 0.3,
      observedMaxRainStationsMm: 0.1,
    })).toBe(false);
  });
});

describe('computeVerdict — quiet predictions (prob < 30)', () => {
  it('marks correct when atmosphere was indeed quiet', () => {
    expect(computeVerdict({
      predictedProbability: 10,
      observedStrikeCount: 0,
      observedMaxRainGridMm: 0,
      observedMaxRainStationsMm: 0,
    })).toBe(true);
  });

  it('marks incorrect when surprise storm hit', () => {
    expect(computeVerdict({
      predictedProbability: 5,
      observedStrikeCount: 25,
      observedMaxRainGridMm: 0,
      observedMaxRainStationsMm: 0,
    })).toBe(false);
  });

  it('marks incorrect when stations recorded heavy rain (gridded missed it)', () => {
    expect(computeVerdict({
      predictedProbability: 15,
      observedStrikeCount: 0,
      observedMaxRainGridMm: 0.5,
      observedMaxRainStationsMm: 8,
    })).toBe(false);
  });
});

describe('computeVerdict — uncertain band (30-59)', () => {
  it('returns null at lower edge (30)', () => {
    expect(computeVerdict({
      predictedProbability: 30,
      observedStrikeCount: 0,
      observedMaxRainGridMm: 0,
      observedMaxRainStationsMm: 0,
    })).toBeNull();
  });

  it('returns null at upper edge (59)', () => {
    expect(computeVerdict({
      predictedProbability: 59,
      observedStrikeCount: 100, // even with massive event, we don't grade
      observedMaxRainGridMm: 50,
      observedMaxRainStationsMm: 50,
    })).toBeNull();
  });

  it('returns null at 50 with quiet outcome', () => {
    expect(computeVerdict({
      predictedProbability: 50,
      observedStrikeCount: 0,
      observedMaxRainGridMm: 0,
      observedMaxRainStationsMm: 0,
    })).toBeNull();
  });
});

describe('computeVerdict — null rain values', () => {
  it('treats null grid rain as 0', () => {
    expect(computeVerdict({
      predictedProbability: 75,
      observedStrikeCount: 10,
      observedMaxRainGridMm: null,
      observedMaxRainStationsMm: null,
    })).toBe(true); // strikes alone confirm
  });

  it('treats null stations rain as 0 — falls back to grid', () => {
    expect(computeVerdict({
      predictedProbability: 70,
      observedStrikeCount: 0,
      observedMaxRainGridMm: 8,
      observedMaxRainStationsMm: null,
    })).toBe(true);
  });
});

describe('VERDICT_THRESHOLDS — sanity', () => {
  it('active prob > quiet prob (no overlap)', () => {
    expect(VERDICT_THRESHOLDS.ACTIVE_PROB).toBeGreaterThan(VERDICT_THRESHOLDS.QUIET_PROB);
  });

  it('active rain > quiet rain', () => {
    expect(VERDICT_THRESHOLDS.ACTIVE_RAIN_MM).toBeGreaterThan(VERDICT_THRESHOLDS.QUIET_RAIN_MM);
  });
});
