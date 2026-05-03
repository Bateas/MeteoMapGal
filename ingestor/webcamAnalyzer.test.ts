/**
 * Tests for the adaptive-schedule heuristic.
 * Pure function in webcamScheduler.ts — no DB / network / sharp.
 */
import { describe, it, expect } from 'vitest';
import { shouldAnalyzeCam, type WebcamScheduleState } from './webcamScheduler';

function state(over: Partial<WebcamScheduleState> = {}): WebcamScheduleState {
  return {
    lastResult: null,
    beaufortHistory: [],
    cyclesSinceLastAnalysis: 0,
    ...over,
  };
}

describe('shouldAnalyzeCam — adaptive schedule (Layer 2)', () => {
  it('first time (no state) — always due', () => {
    expect(shouldAnalyzeCam(undefined)).toBe(true);
  });

  it('beaufort >= 4 in last reading — every cycle (active event)', () => {
    const s = state({ lastResult: { beaufort: 5 }, cyclesSinceLastAnalysis: 0 });
    expect(shouldAnalyzeCam(s)).toBe(true);
  });

  it('beaufort 4 with 0 cycles since — still due (event override)', () => {
    const s = state({ lastResult: { beaufort: 4 }, cyclesSinceLastAnalysis: 0 });
    expect(shouldAnalyzeCam(s)).toBe(true);
  });

  it('stable calm (5 readings ≤ 1) waits 4 cycles', () => {
    const calm = state({
      lastResult: { beaufort: 0 },
      beaufortHistory: [0, 1, 0, 1, 0],
      cyclesSinceLastAnalysis: 3,
    });
    expect(shouldAnalyzeCam(calm)).toBe(false);

    const due = state({
      lastResult: { beaufort: 0 },
      beaufortHistory: [0, 1, 0, 1, 0],
      cyclesSinceLastAnalysis: 4,
    });
    expect(shouldAnalyzeCam(due)).toBe(true);
  });

  it('default cadence: any non-stable, non-event state waits 3 cycles', () => {
    const fresh = state({
      lastResult: { beaufort: 2 },
      beaufortHistory: [2, 2],
      cyclesSinceLastAnalysis: 2,
    });
    expect(shouldAnalyzeCam(fresh)).toBe(false);

    const due = state({
      lastResult: { beaufort: 2 },
      beaufortHistory: [2, 2],
      cyclesSinceLastAnalysis: 3,
    });
    expect(shouldAnalyzeCam(due)).toBe(true);
  });

  it('history with one above-threshold reading breaks "stable calm" — falls back to 3 cycles', () => {
    const s = state({
      lastResult: { beaufort: 1 },
      beaufortHistory: [1, 0, 2, 0, 1], // one "2" — not stable calm
      cyclesSinceLastAnalysis: 3,
    });
    expect(shouldAnalyzeCam(s)).toBe(true);
  });

  it('history of 4 readings (not yet 5) — not stable calm yet, default cadence', () => {
    const s = state({
      lastResult: { beaufort: 0 },
      beaufortHistory: [0, 0, 0, 0],
      cyclesSinceLastAnalysis: 3,
    });
    expect(shouldAnalyzeCam(s)).toBe(true);
  });

  it('beaufort -1 (no water visible) — does not trigger event branch', () => {
    const s = state({
      lastResult: { beaufort: -1 },
      beaufortHistory: [-1, -1],
      cyclesSinceLastAnalysis: 2,
    });
    expect(shouldAnalyzeCam(s)).toBe(false); // 3 cycles needed
  });
});
