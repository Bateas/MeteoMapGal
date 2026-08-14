import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HourlyForecast } from '../types/forecast';

const fetchMeteoSixForecast = vi.hoisted(() => vi.fn());
vi.mock('../api/meteoSixClient', () => ({ fetchMeteoSixForecast }));

import {
  fetchSpotForecast,
  isSpotForecastStale,
  __clearSpotForecastInFlight,
  SPOT_FORECAST_TTL_MS,
  SPOT_FORECAST_RETRY_MS,
} from './spotForecastFetch';

/** One hour of forecast — only the shape matters here. */
function hour(): HourlyForecast[] {
  return [{ time: new Date('2026-08-14T16:00:00Z'), windSpeed: 5 } as HourlyForecast];
}

/** A promise plus its resolvers, so a case can hold a request open. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  __clearSpotForecastInFlight();
  fetchMeteoSixForecast.mockReset();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('isSpotForecastStale', () => {
  const now = 1_000_000_000;

  it('treats a missing cache as stale — this is the cold open', () => {
    expect(isSpotForecastStale(undefined, now)).toBe(true);
  });

  it('keeps a fresh cache', () => {
    expect(isSpotForecastStale({ fetchedAt: now - 60_000 }, now)).toBe(false);
  });

  it('expires once past the TTL', () => {
    expect(isSpotForecastStale({ fetchedAt: now - SPOT_FORECAST_TTL_MS - 1 }, now)).toBe(true);
  });
});

describe('fetchSpotForecast — in-flight dedup', () => {
  it('serves a second caller the SAME request instead of firing another', async () => {
    const d = deferred<HourlyForecast[]>();
    fetchMeteoSixForecast.mockReturnValue(d.promise);

    // Two mounts in the same tick — StrictMode in dev, close-and-reopen in prod.
    const a = fetchSpotForecast('castrelo', 42.2991, -8.1087);
    const b = fetchSpotForecast('castrelo', 42.2991, -8.1087);

    expect(fetchMeteoSixForecast).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);

    const data = hour();
    d.resolve(data);
    await expect(a).resolves.toBe(data);
    await expect(b).resolves.toBe(data);
  });

  it('does not share between different spots', async () => {
    fetchMeteoSixForecast.mockResolvedValue(hour());
    await Promise.all([
      fetchSpotForecast('castrelo', 42.29, -8.10),
      fetchSpotForecast('cesantes', 42.30, -8.61),
    ]);
    expect(fetchMeteoSixForecast).toHaveBeenCalledTimes(2);
  });

  it('releases the slot once settled, so a later open fetches again', async () => {
    fetchMeteoSixForecast.mockResolvedValue(hour());

    await fetchSpotForecast('castrelo', 42.29, -8.10);
    await fetchSpotForecast('castrelo', 42.29, -8.10);

    expect(fetchMeteoSixForecast).toHaveBeenCalledTimes(2);
  });

  it('does not poison the spot after a failure — the next open retries', async () => {
    // Both attempts fail: the breaker error skips the retry path entirely.
    const breakerErr = Object.assign(new Error('open'), { name: 'MeteoSixBreakerOpenError' });
    fetchMeteoSixForecast.mockRejectedValue(breakerErr);

    await expect(fetchSpotForecast('castrelo', 42.29, -8.10)).rejects.toThrow('open');
    expect(fetchMeteoSixForecast).toHaveBeenCalledTimes(1);

    // A poisoned cache would hand back the same rejection without calling out.
    await expect(fetchSpotForecast('castrelo', 42.29, -8.10)).rejects.toThrow('open');
    expect(fetchMeteoSixForecast).toHaveBeenCalledTimes(2);
  });
});

describe('fetchSpotForecast — retry', () => {
  it('retries once after a plain failure and resolves with the second answer', async () => {
    vi.useFakeTimers();
    const data = hour();
    fetchMeteoSixForecast
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValueOnce(data);

    const p = fetchSpotForecast('castrelo', 42.29, -8.10);
    // Let the first rejection propagate into the catch that arms the timer.
    await vi.advanceTimersByTimeAsync(SPOT_FORECAST_RETRY_MS + 1);

    await expect(p).resolves.toBe(data);
    expect(fetchMeteoSixForecast).toHaveBeenCalledTimes(2);
  });

  it('skips the retry when the circuit breaker is already open', async () => {
    const breakerErr = Object.assign(new Error('open 180s'), { name: 'MeteoSixBreakerOpenError' });
    fetchMeteoSixForecast.mockRejectedValueOnce(breakerErr);

    await expect(fetchSpotForecast('castrelo', 42.29, -8.10)).rejects.toThrow('open 180s');
    // Waiting 3s for a call we already know short-circuits helps nobody.
    expect(fetchMeteoSixForecast).toHaveBeenCalledTimes(1);
  });
});
