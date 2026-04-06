import { describe, it, expect } from 'vitest';
import { computeSurfVerdict } from './surfVerdictEngine';

describe('computeSurfVerdict', () => {
  // ── Base levels (no modifiers) ──
  it('returns FLAT for <0.3m', () => {
    expect(computeSurfVerdict(0.2, 8, false, false).label).toBe('FLAT');
  });
  it('returns PEQUE for 0.3-0.8m', () => {
    expect(computeSurfVerdict(0.5, 8, false, false).label).toBe('PEQUE');
  });
  it('returns SURF OK for 0.8-1.5m', () => {
    expect(computeSurfVerdict(1.0, 8, false, false).label).toBe('SURF OK');
  });
  it('returns CLASICO for 1.5-2.5m', () => {
    expect(computeSurfVerdict(2.0, 8, false, false).label).toBe('CLASICO');
  });
  it('returns GRANDE for >=2.5m', () => {
    expect(computeSurfVerdict(3.0, 8, false, false).label).toBe('GRANDE');
  });

  // ── Offshore bonus (+1) ──
  it('offshore upgrades PEQUE to SURF OK', () => {
    expect(computeSurfVerdict(0.5, 8, true, false).label).toBe('SURF OK');
  });
  it('offshore does NOT upgrade FLAT (level 0)', () => {
    expect(computeSurfVerdict(0.1, 8, true, false).label).toBe('FLAT');
  });

  // ── Onshore penalty (-1) ──
  it('onshore downgrades SURF OK to PEQUE', () => {
    expect(computeSurfVerdict(1.0, 8, false, true).label).toBe('PEQUE');
  });

  // ── Period bonus (only if swell aligned) ──
  it('long period + aligned upgrades PEQUE to SURF OK', () => {
    expect(computeSurfVerdict(0.5, 12, false, false, true).label).toBe('SURF OK');
  });
  it('long period + NOT aligned does NOT upgrade', () => {
    expect(computeSurfVerdict(0.5, 12, false, false, false).label).toBe('PEQUE');
  });
  it('short period (<5s) downgrades', () => {
    expect(computeSurfVerdict(1.0, 3, false, false).label).toBe('PEQUE');
  });

  // ── Bonus cap at +1 ──
  it('offshore + long period capped at +1 total', () => {
    // 0.5m = PEQUE (1), offshore +1, period +1, but cap = +1 → SURF OK (2)
    expect(computeSurfVerdict(0.5, 12, true, false, true).label).toBe('SURF OK');
  });

  // ── Hard floor: CLASICO needs >= 1.0m ──
  it('0.8m + offshore cannot be CLASICO (hard floor 1.0m)', () => {
    // 0.8m = SURF OK (2), offshore +1 → would be 3 (CLASICO), but hard floor blocks
    expect(computeSurfVerdict(0.8, 12, true, false).label).toBe('SURF OK');
  });
  it('1.0m + offshore CAN be CLASICO', () => {
    expect(computeSurfVerdict(1.0, 12, true, false).label).toBe('CLASICO');
  });

  // ── Hard floor: GRANDE needs >= 1.8m ──
  it('1.7m + offshore cannot be GRANDE (hard floor 1.8m)', () => {
    // 1.7m = CLASICO (3), offshore +1 → would be 4 (GRANDE), but floor blocks
    expect(computeSurfVerdict(1.7, 12, true, false).label).toBe('CLASICO');
  });
  it('1.8m + offshore CAN be GRANDE', () => {
    expect(computeSurfVerdict(1.8, 12, true, false).label).toBe('GRANDE');
  });

  // ── Real scenario: Patos with 0.85m corrected, offshore, period 9s ──
  it('Patos typical: 0.85m offshore 9s = SURF OK (not CLASICO)', () => {
    const result = computeSurfVerdict(0.85, 9, true, false);
    expect(result.label).toBe('SURF OK');
  });

  // ── Summary includes details ──
  it('summary includes wave height and period', () => {
    const result = computeSurfVerdict(1.5, 10, false, false);
    expect(result.summary).toContain('1.5m');
    expect(result.summary).toContain('10s');
  });
  it('summary includes offshore warning text', () => {
    const result = computeSurfVerdict(1.0, 8, true, false);
    expect(result.summary).toContain('offshore');
  });
});
