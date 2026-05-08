/**
 * Tests for marineClient circuit breaker.
 *
 * Single shared breaker for both `fetchMarineData` (current) and
 * `fetchMarineForecast` (hourly). 3min cooldown. Trips on any 5xx or
 * network failure; first success clears.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchMarineData,
  fetchMarineForecast,
  _resetMarineBreaker,
} from './marineClient';

describe('marineClient circuit breaker', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
    _resetMarineBreaker();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('trips on 5xx and short-circuits subsequent fetchMarineData calls', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return new Response('upstream down', { status: 503 });
    }) as unknown as typeof globalThis.fetch;

    // First call hits the network, returns null (no cache)
    const r1 = await fetchMarineData(42.3, -8.7);
    expect(r1).toBeNull();
    expect(callCount).toBe(1);

    // Breaker now open — second call returns null without touching network
    const r2 = await fetchMarineData(42.4, -8.8);
    expect(r2).toBeNull();
    expect(callCount).toBe(1);
  });

  it('breaker is shared between current and forecast endpoints', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return new Response('boom', { status: 502 });
    }) as unknown as typeof globalThis.fetch;

    // Trip via current
    await fetchMarineData(42.3, -8.7);
    expect(callCount).toBe(1);

    // Forecast must also short-circuit (same upstream)
    const r = await fetchMarineForecast(42.3, -8.7);
    expect(r).toEqual([]);
    expect(callCount).toBe(1);
  });

  it('successful response clears the breaker', async () => {
    let callCount = 0;
    let shouldFail = true;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (shouldFail) return new Response('boom', { status: 503 });
      return new Response(
        JSON.stringify({
          current: {
            wave_height: 1.2,
            wave_period: 8,
            wave_direction: 270,
            swell_wave_height: 0.8,
            sea_surface_temperature: 14.5,
          },
        }),
        { status: 200 },
      );
    }) as unknown as typeof globalThis.fetch;

    await fetchMarineData(42.3, -8.7);
    expect(callCount).toBe(1);

    vi.advanceTimersByTime(3 * 60_000 + 1_000);
    shouldFail = false;

    const r = await fetchMarineData(42.4, -8.8); // different key avoids 10min cache hit
    expect(r?.waveHeight).toBe(1.2);
    expect(callCount).toBe(2);

    // Breaker cleared — next call (different coords) goes through
    const r2 = await fetchMarineData(42.5, -8.9);
    expect(r2?.waveHeight).toBe(1.2);
    expect(callCount).toBe(3);
  });
});
