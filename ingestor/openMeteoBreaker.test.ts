/**
 * Tests for the shared Open-Meteo breaker.
 *
 * The contract:
 *   - reportRateLimit() opens the breaker for the cooldown window
 *   - isOpen() returns true while inside the window
 *   - checkBreaker() throws OpenMeteoBreakerError while open
 *   - reportSuccess() clears the breaker
 *   - State is module-level — every test must reset it
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isOpen,
  minutesUntilReset,
  checkBreaker,
  reportRateLimit,
  reportSuccess,
  _resetOpenMeteoBreaker,
  OpenMeteoBreakerError,
} from './openMeteoBreaker';

describe('openMeteoBreaker', () => {
  beforeEach(() => {
    _resetOpenMeteoBreaker();
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

  it('opens after a rate-limit report', () => {
    reportRateLimit('forecast');
    expect(isOpen()).toBe(true);
    expect(minutesUntilReset()).toBeGreaterThan(0);
    expect(() => checkBreaker('test')).toThrow(OpenMeteoBreakerError);
  });

  it('reports correct minutes remaining', () => {
    reportRateLimit('forecast');
    expect(minutesUntilReset()).toBe(60);

    vi.advanceTimersByTime(30 * 60_000);
    expect(minutesUntilReset()).toBe(30);

    vi.advanceTimersByTime(29 * 60_000);
    expect(minutesUntilReset()).toBe(1);
  });

  it('auto-closes after the cooldown window', () => {
    reportRateLimit('forecast');
    expect(isOpen()).toBe(true);

    vi.advanceTimersByTime(60 * 60_000 + 1_000);
    expect(isOpen()).toBe(false);
    expect(minutesUntilReset()).toBe(0);
    expect(() => checkBreaker('test')).not.toThrow();
  });

  it('reportSuccess clears the breaker immediately', () => {
    reportRateLimit('convgrid');
    expect(isOpen()).toBe(true);

    reportSuccess();
    expect(isOpen()).toBe(false);
    expect(() => checkBreaker('test')).not.toThrow();
  });

  it('breaker is shared — any caller can open, any can clear', () => {
    reportRateLimit('synoptic');
    expect(isOpen()).toBe(true); // tripped by synoptic

    // ConvGrid would also see it open
    expect(() => checkBreaker('convgrid')).toThrow(OpenMeteoBreakerError);

    // Forecast clears it on a successful response
    reportSuccess();
    expect(isOpen()).toBe(false);

    // ConvGrid can now fire too
    expect(() => checkBreaker('convgrid')).not.toThrow();
  });

  it('OpenMeteoBreakerError carries the caller label', () => {
    reportRateLimit('forecast');
    let caught: unknown;
    try {
      checkBreaker('marine');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OpenMeteoBreakerError);
    expect((caught as Error).message).toContain('marine');
    expect((caught as Error).message).toContain('cooldown');
  });
});
