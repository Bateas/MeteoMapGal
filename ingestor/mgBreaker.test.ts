/**
 * Tests for the MeteoGalicia network breaker.
 *
 * The contract differs from lightningBreaker in the SIGNAL it reacts to: not
 * "one call failed", but "a whole cycle's station fan-out failed together" —
 * `reportCycleResult(attempted, failed)` only counts toward the threshold
 * when EVERY attempted station rejected. A partial failure (some stations
 * fine, a few timed out) is the ordinary case and must reset the counter,
 * not accumulate toward it.
 *
 *   - reportCycleResult() opens only after FAILURE_THRESHOLD fully-failed cycles
 *   - any cycle with at least one success clears the counter immediately
 *   - isOpen() / checkBreaker() reflect the cooldown window
 *   - State is module-level — every test must reset it
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isOpen,
  minutesUntilReset,
  checkBreaker,
  reportCycleResult,
  reportSuccess,
  _resetMgBreaker,
  MgBreakerError,
} from './mgBreaker';

describe('mgBreaker', () => {
  beforeEach(() => {
    _resetMgBreaker();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts closed', () => {
    expect(isOpen()).toBe(false);
    expect(minutesUntilReset()).toBe(0);
    expect(() => checkBreaker('test')).not.toThrow();
  });

  it('a cycle with zero attempted stations is a no-op', () => {
    reportCycleResult(0, 0);
    expect(isOpen()).toBe(false);
  });

  it('stays closed for a single fully-failed cycle', () => {
    reportCycleResult(187, 187);
    expect(isOpen()).toBe(false);
    expect(() => checkBreaker('test')).not.toThrow();
  });

  it('a partial failure never counts toward the threshold, however large', () => {
    reportCycleResult(187, 186); // 1 station succeeded
    reportCycleResult(187, 186);
    reportCycleResult(187, 186);
    reportCycleResult(187, 186);
    expect(isOpen()).toBe(false);
  });

  it('opens after the threshold of consecutive FULLY-failed cycles', () => {
    reportCycleResult(187, 187); // 1
    expect(isOpen()).toBe(false);

    reportCycleResult(187, 187); // 2 → trips
    expect(isOpen()).toBe(true);
    expect(minutesUntilReset()).toBe(15);
    expect(() => checkBreaker('test')).toThrow(MgBreakerError);
  });

  it('a success mid-sequence resets the counter so failures must re-accumulate', () => {
    reportCycleResult(187, 187); // 1
    reportCycleResult(150, 5);   // mostly fine → resets
    expect(isOpen()).toBe(false);

    reportCycleResult(187, 187); // 1 again
    expect(isOpen()).toBe(false); // still below threshold
    reportCycleResult(187, 187); // 2 → trips
    expect(isOpen()).toBe(true);
  });

  it('auto-closes after the cooldown window', () => {
    reportCycleResult(187, 187);
    reportCycleResult(187, 187);
    expect(isOpen()).toBe(true);

    vi.advanceTimersByTime(15 * 60_000 + 1_000);
    expect(isOpen()).toBe(false);
    expect(minutesUntilReset()).toBe(0);
    expect(() => checkBreaker('test')).not.toThrow();
  });

  it('re-opens immediately on a single fully-failed probe cycle after cooldown', () => {
    reportCycleResult(187, 187);
    reportCycleResult(187, 187); // open
    vi.advanceTimersByTime(15 * 60_000 + 1_000); // cooldown elapses
    expect(isOpen()).toBe(false);

    // The probe cycle fails fully → counter is still past threshold, so it
    // re-opens without waiting for 2 fresh fully-failed cycles.
    reportCycleResult(187, 187);
    expect(isOpen()).toBe(true);
  });

  it('reportSuccess clears an open breaker immediately', () => {
    reportCycleResult(187, 187);
    reportCycleResult(187, 187);
    expect(isOpen()).toBe(true);

    reportSuccess();
    expect(isOpen()).toBe(false);
    expect(() => checkBreaker('test')).not.toThrow();
  });

  it('MgBreakerError carries the caller label', () => {
    reportCycleResult(187, 187);
    reportCycleResult(187, 187);
    let caught: unknown;
    try {
      checkBreaker('observation poll');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MgBreakerError);
    expect((caught as Error).message).toContain('observation poll');
    expect((caught as Error).message).toContain('cooldown');
  });
});
