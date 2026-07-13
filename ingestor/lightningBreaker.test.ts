/**
 * Tests for the meteo2api lightning breaker.
 *
 * The contract differs from the Open-Meteo / AEMET breakers in one way: it
 * opens on REPEATED failure (FAILURE_THRESHOLD consecutive failures), not on
 * the first one — meteo2api has no rate limit, so a single blip self-recovers.
 *
 *   - reportFailure() opens only after the threshold is reached
 *   - reportSuccess() resets the counter and clears the breaker
 *   - isOpen() / checkBreaker() reflect the cooldown window
 *   - State is module-level — every test must reset it
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isOpen,
  minutesUntilReset,
  checkBreaker,
  reportFailure,
  reportSuccess,
  _resetLightningBreaker,
  LightningBreakerError,
} from './lightningBreaker';

describe('lightningBreaker', () => {
  beforeEach(() => {
    _resetLightningBreaker();
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

  it('stays closed for a single transient failure', () => {
    reportFailure('timeout');
    expect(isOpen()).toBe(false);
    expect(() => checkBreaker('test')).not.toThrow();
  });

  it('opens only after the threshold of consecutive failures', () => {
    reportFailure('timeout'); // 1
    reportFailure('timeout'); // 2
    expect(isOpen()).toBe(false);

    reportFailure('timeout'); // 3 → trips
    expect(isOpen()).toBe(true);
    expect(minutesUntilReset()).toBe(20);
    expect(() => checkBreaker('test')).toThrow(LightningBreakerError);
  });

  it('a success resets the counter so failures must re-accumulate', () => {
    reportFailure('timeout'); // 1
    reportFailure('timeout'); // 2
    reportSuccess();          // counter → 0
    expect(isOpen()).toBe(false);

    reportFailure('timeout'); // 1 again
    reportFailure('timeout'); // 2
    expect(isOpen()).toBe(false); // still below threshold
    reportFailure('timeout'); // 3 → trips
    expect(isOpen()).toBe(true);
  });

  it('auto-closes after the cooldown window', () => {
    reportFailure('a');
    reportFailure('b');
    reportFailure('c');
    expect(isOpen()).toBe(true);

    vi.advanceTimersByTime(20 * 60_000 + 1_000);
    expect(isOpen()).toBe(false);
    expect(minutesUntilReset()).toBe(0);
    expect(() => checkBreaker('test')).not.toThrow();
  });

  it('re-opens immediately on a single failure after the cooldown probe', () => {
    reportFailure('a');
    reportFailure('b');
    reportFailure('c'); // open
    vi.advanceTimersByTime(20 * 60_000 + 1_000); // cooldown elapses
    expect(isOpen()).toBe(false);

    // The probe cycle fails once → counter is still past the threshold, so it
    // re-opens without waiting for 3 fresh failures.
    reportFailure('probe-failed');
    expect(isOpen()).toBe(true);
  });

  it('reportSuccess clears an open breaker immediately', () => {
    reportFailure('a');
    reportFailure('b');
    reportFailure('c');
    expect(isOpen()).toBe(true);

    reportSuccess();
    expect(isOpen()).toBe(false);
    expect(() => checkBreaker('test')).not.toThrow();
  });

  it('LightningBreakerError carries the caller label', () => {
    reportFailure('a');
    reportFailure('b');
    reportFailure('c');
    let caught: unknown;
    try {
      checkBreaker('lightning-poll');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LightningBreakerError);
    expect((caught as Error).message).toContain('lightning-poll');
    expect((caught as Error).message).toContain('cooldown');
  });
});
