/**
 * Tests for meteoSixClient circuit breaker.
 *
 * Per-endpoint breaker (wrf/uswan/mohid). First failure trips it for 3min;
 * subsequent calls reject immediately without touching the network. A
 * successful response clears it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchMeteoSixForecast,
  fetchMeteoSixMarine,
  fetchMeteoSixSeaTemp,
  _resetMeteoSixBreakers,
} from './meteoSixClient';

const VALID_FORECAST_FEATURE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-8.7, 42.3] },
      properties: {
        days: [
          {
            timePeriod: {
              begin: { timeInstant: '2026-05-08T12:00:00+02' },
              end: { timeInstant: '2026-05-08T13:00:00+02' },
            },
            variables: [],
          },
        ],
      },
    },
  ],
};

describe('meteoSixClient circuit breaker', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
    _resetMeteoSixBreakers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('WRF breaker trips on 5xx then short-circuits subsequent calls', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return new Response('upstream down', { status: 503 });
    }) as unknown as typeof globalThis.fetch;

    // First call hits the network and throws
    await expect(fetchMeteoSixForecast(42.3, -8.7)).rejects.toThrow(/MeteoSIX WRF: 503/);
    expect(callCount).toBe(1);

    // Breaker is now open — second call must NOT hit the network
    await expect(fetchMeteoSixForecast(42.3, -8.7)).rejects.toThrow(/breaker open/);
    expect(callCount).toBe(1);
  });

  it('USWAN breaker trips independently from WRF', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return new Response('boom', { status: 502 });
    }) as unknown as typeof globalThis.fetch;

    await expect(fetchMeteoSixMarine(42.3, -8.7)).rejects.toThrow(/MeteoSIX USWAN: 502/);
    expect(callCount).toBe(1);

    // Same endpoint short-circuits
    await expect(fetchMeteoSixMarine(42.3, -8.7)).rejects.toThrow(/breaker open/);
    expect(callCount).toBe(1);
  });

  it('MOHID breaker returns [] silently when open (best-effort endpoint)', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return new Response('down', { status: 503 });
    }) as unknown as typeof globalThis.fetch;

    // First call: network → 503 → trips breaker → returns []
    const r1 = await fetchMeteoSixSeaTemp(42.3, -8.7);
    expect(r1).toEqual([]);
    expect(callCount).toBe(1);

    // Second call: breaker open → returns [] without touching network
    const r2 = await fetchMeteoSixSeaTemp(42.3, -8.7);
    expect(r2).toEqual([]);
    expect(callCount).toBe(1);
  });

  it('successful response clears the breaker', async () => {
    let callCount = 0;
    let shouldFail = true;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (shouldFail) {
        return new Response('boom', { status: 503 });
      }
      return new Response(JSON.stringify(VALID_FORECAST_FEATURE), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    // Trip breaker
    await expect(fetchMeteoSixForecast(42.3, -8.7)).rejects.toThrow();
    expect(callCount).toBe(1);

    // Advance past cooldown (3min + 1s margin)
    vi.advanceTimersByTime(3 * 60_000 + 1_000);

    // Now upstream recovers
    shouldFail = false;
    const result = await fetchMeteoSixForecast(42.3, -8.7);
    expect(Array.isArray(result)).toBe(true);
    expect(callCount).toBe(2);

    // Subsequent call goes through (breaker cleared by success)
    const result2 = await fetchMeteoSixForecast(42.3, -8.7);
    expect(Array.isArray(result2)).toBe(true);
    expect(callCount).toBe(3);
  });
});
