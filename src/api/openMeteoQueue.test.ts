/**
 * Tests for the Open-Meteo queue circuit breaker.
 *
 * The breaker trips after 3 consecutive 429s and freezes all calls for
 * 5 minutes — preventing the cascade where the IP is rate-limited and
 * each retry burns 25s of backoff for nothing. First success clears it.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { openMeteoFetch } from './openMeteoQueue';

describe('openMeteoQueue circuit breaker', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('opens after 3 consecutive 429s', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return new Response(null, { status: 429, statusText: 'Too Many Requests' });
    }) as unknown as typeof globalThis.fetch;

    // First three calls trigger 429 + retries → all fail
    const p1 = openMeteoFetch('https://api.open-meteo.com/v1/forecast?test=1');
    await vi.runAllTimersAsync();
    const r1 = await p1;
    expect(r1.status).toBe(429);

    const p2 = openMeteoFetch('https://api.open-meteo.com/v1/forecast?test=2');
    await vi.runAllTimersAsync();
    const r2 = await p2;
    expect(r2.status).toBe(429);

    const p3 = openMeteoFetch('https://api.open-meteo.com/v1/forecast?test=3');
    await vi.runAllTimersAsync();
    const r3 = await p3;
    expect(r3.status).toBe(429);

    // Breaker is now tripped. Next call should NOT touch fetch at all.
    const callsBeforeBreaker = callCount;
    const p4 = openMeteoFetch('https://api.open-meteo.com/v1/forecast?test=4');
    await vi.runAllTimersAsync();
    const r4 = await p4;
    expect(r4.status).toBe(429);
    expect(r4.statusText).toBe('Cooldown');
    expect(callCount).toBe(callsBeforeBreaker); // no new fetch happened
  });
});
