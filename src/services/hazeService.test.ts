/**
 * Tests for hazeService — calima/Saharan-dust classifier.
 *
 * Pure function. Bug here = wrong overlay tint/opacity, but no data corruption.
 */

import { describe, it, expect } from 'vitest';
import { classifyHaze } from './hazeService';

describe('classifyHaze — null/zero inputs', () => {
  it('returns severity=none for both null', () => {
    const r = classifyHaze(null, null);
    expect(r.severity).toBe('none');
    expect(r.tint).toBeNull();
    expect(r.opacity).toBe(0);
    expect(r.label).toBe('');
  });

  it('returns severity=none for both undefined', () => {
    const r = classifyHaze(undefined, undefined);
    expect(r.severity).toBe('none');
  });

  it('returns severity=none for both zero', () => {
    expect(classifyHaze(0, 0).severity).toBe('none');
  });

  it('returns severity=none for trace levels (just below leve thresholds)', () => {
    expect(classifyHaze(24.9, 0.24).severity).toBe('none');
  });
});

describe('classifyHaze — dust-driven severity', () => {
  it('leve at dust=25 (boundary)', () => {
    const r = classifyHaze(25, 0);
    expect(r.severity).toBe('leve');
    expect(r.label).toBe('Calima leve');
    expect(r.opacity).toBe(0.06);
    expect(r.tint).toEqual([180, 130, 70]);
  });

  it('moderada at dust=50 (boundary)', () => {
    const r = classifyHaze(50, 0);
    expect(r.severity).toBe('moderada');
    expect(r.label).toBe('Calima moderada');
    expect(r.opacity).toBe(0.12);
  });

  it('fuerte at dust=100 (boundary)', () => {
    const r = classifyHaze(100, 0);
    expect(r.severity).toBe('fuerte');
    expect(r.label).toBe('Calima fuerte');
    expect(r.opacity).toBe(0.22);
  });

  it('fuerte at dust=300 (extreme calima event)', () => {
    expect(classifyHaze(300, 0).severity).toBe('fuerte');
  });
});

describe('classifyHaze — AOD-driven severity', () => {
  it('leve at AOD=0.25 (boundary)', () => {
    expect(classifyHaze(0, 0.25).severity).toBe('leve');
  });

  it('moderada at AOD=0.4 (boundary)', () => {
    expect(classifyHaze(0, 0.4).severity).toBe('moderada');
  });

  it('fuerte at AOD=0.7 (boundary)', () => {
    expect(classifyHaze(0, 0.7).severity).toBe('fuerte');
  });

  it('fuerte at AOD=1.5 (very heavy)', () => {
    expect(classifyHaze(0, 1.5).severity).toBe('fuerte');
  });
});

describe('classifyHaze — combined signals (max wins)', () => {
  it('moderada dust + leve AOD → moderada (worst-case)', () => {
    expect(classifyHaze(60, 0.3).severity).toBe('moderada');
  });

  it('leve dust + fuerte AOD → fuerte (worst-case)', () => {
    expect(classifyHaze(30, 0.8).severity).toBe('fuerte');
  });

  it('zero dust + moderate AOD still classifies (handles missing one signal)', () => {
    expect(classifyHaze(0, 0.5).severity).toBe('moderada');
  });

  it('zero AOD + fuerte dust still classifies', () => {
    expect(classifyHaze(150, 0).severity).toBe('fuerte');
  });
});

describe('classifyHaze — output shape', () => {
  it('tint is brownish ochre when active', () => {
    const r = classifyHaze(100, 0);
    expect(r.tint).toEqual([180, 130, 70]);
  });

  it('opacity strictly increasing with severity', () => {
    const leve = classifyHaze(30, 0).opacity;
    const mod = classifyHaze(60, 0).opacity;
    const fue = classifyHaze(150, 0).opacity;
    expect(leve).toBeLessThan(mod);
    expect(mod).toBeLessThan(fue);
  });

  it('opacity caps at 0.22 even for extreme dust (no full mask)', () => {
    // Even worst case, map must remain readable
    expect(classifyHaze(500, 2).opacity).toBeLessThanOrEqual(0.25);
  });
});

// ── S126: AEMET visibility cross-feed ───────────────────────────

describe('classifyHaze — visibility cross-feed (S126 multi-evidence)', () => {
  it('low visibility ALONE does NOT trigger calima (could be fog)', () => {
    // No model evidence + AEMET reports 0.5km vis → still none
    expect(classifyHaze(0, 0, 0.5).severity).toBe('none');
    expect(classifyHaze(null, null, 1).severity).toBe('none');
  });

  it('vis<2km + any model leve+ → bumped to fuerte', () => {
    // Model says leve, visibility confirms strong → fuerte
    expect(classifyHaze(30, 0, 1).severity).toBe('fuerte');
    // Model says moderada → fuerte
    expect(classifyHaze(60, 0, 0.5).severity).toBe('fuerte');
    // Model already fuerte → still fuerte (idempotent)
    expect(classifyHaze(150, 0, 0.5).severity).toBe('fuerte');
  });

  it('vis<5km + leve → bumped to moderada', () => {
    expect(classifyHaze(30, 0, 3).severity).toBe('moderada');
    // Boundary: vis=4.9 still triggers
    expect(classifyHaze(30, 0, 4.9).severity).toBe('moderada');
  });

  it('vis<5km + moderada → STAYS moderada (no double bump)', () => {
    // We already classified as moderada by model; visibility just confirms
    expect(classifyHaze(60, 0, 3).severity).toBe('moderada');
  });

  it('vis≥5km does NOT bump anything (atmosphere clean enough)', () => {
    expect(classifyHaze(30, 0, 8).severity).toBe('leve');
    expect(classifyHaze(60, 0, 10).severity).toBe('moderada');
  });

  it('null/undefined visibility behaves like before (no bump, just model)', () => {
    expect(classifyHaze(30, 0, null).severity).toBe('leve');
    expect(classifyHaze(30, 0, undefined).severity).toBe('leve');
    expect(classifyHaze(30, 0).severity).toBe('leve');
  });

  it('NaN visibility ignored (defensive)', () => {
    expect(classifyHaze(30, 0, NaN).severity).toBe('leve');
    expect(classifyHaze(30, 0, Infinity).severity).toBe('leve');
  });

  it('visibility cross-feed only acts when model has detected (multi-evidence override)', () => {
    // ZERO model + low visibility → none. Visibility alone cannot trigger.
    expect(classifyHaze(0, 0, 0.5).severity).toBe('none');
    expect(classifyHaze(null, null, 0.1).severity).toBe('none');
  });
});
