/**
 * Tests for the webcam schedule.
 * Pure function in webcamScheduler.ts — no DB / network / sharp.
 */
import { describe, it, expect } from 'vitest';
import { shouldAnalyzeCam, type WebcamScheduleState } from './webcamScheduler';

function state(over: Partial<WebcamScheduleState> = {}): WebcamScheduleState {
  return {
    lastResult: { fog: false },
    cyclesSinceLastAnalysis: 0,
    ...over,
  };
}

describe('shouldAnalyzeCam — fog sets the pace', () => {
  it('first time (no state) — always due', () => {
    expect(shouldAnalyzeCam(undefined)).toBe(true);
  });

  it('nothing seen: every 4 cycles (20 min)', () => {
    expect(shouldAnalyzeCam(state({ cyclesSinceLastAnalysis: 3 }))).toBe(false);
    expect(shouldAnalyzeCam(state({ cyclesSinceLastAnalysis: 4 }))).toBe(true);
  });

  it('the camera saw fog: every 2 cycles (10 min), to confirm or clear it', () => {
    expect(shouldAnalyzeCam(state({ lastResult: { fog: true }, cyclesSinceLastAnalysis: 1 }))).toBe(false);
    expect(shouldAnalyzeCam(state({ lastResult: { fog: true }, cyclesSinceLastAnalysis: 2 }))).toBe(true);
  });

  it('no room for fog last time: the stations are read again after 2 cycles, whatever it saw before', () => {
    const closed = state({ lastResult: { fog: true }, gateClosed: true });
    expect(shouldAnalyzeCam({ ...closed, cyclesSinceLastAnalysis: 1 })).toBe(false);
    expect(shouldAnalyzeCam({ ...closed, cyclesSinceLastAnalysis: 2 })).toBe(true);
  });

  it('a camera that never produced a result waits the default cadence', () => {
    expect(shouldAnalyzeCam(state({ lastResult: null, cyclesSinceLastAnalysis: 3 }))).toBe(false);
    expect(shouldAnalyzeCam(state({ lastResult: null, cyclesSinceLastAnalysis: 4 }))).toBe(true);
  });
});
