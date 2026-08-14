import { fetchMeteoSixForecast } from '../api/meteoSixClient';
import type { HourlyForecast } from '../types/forecast';

/** How long a cached per-spot forecast stays good before we ask again. */
export const SPOT_FORECAST_TTL_MS = 30 * 60_000;

/** Wait before the single retry, exported so tests do not hardcode it. */
export const SPOT_FORECAST_RETRY_MS = 3000;

/**
 * Requests still in the air, keyed by spot id.
 *
 * The popup can mount twice before the first request lands — React StrictMode
 * double-invokes effects in dev, and in production the user only has to close
 * and reopen the popup. Handing the second mount the SAME promise is what
 * turns that into one request instead of two 30-second calls to MeteoSIX.
 *
 * Entries are dropped as soon as they settle, success or failure, so this map
 * only ever holds work in progress. The 30-minute DATA cache is a different
 * thing and lives in the store: keeping a resolved promise here as well would
 * give us two caches with two expiry rules disagreeing with each other, and
 * keeping a REJECTED one would poison the spot until a reload.
 */
const inFlight = new Map<string, Promise<HourlyForecast[]>>();

/** Test-only: drop in-flight entries so one case cannot leak into the next. */
export function __clearSpotForecastInFlight(): void {
  inFlight.clear();
}

/** True when there is no cached forecast, or the one we have has expired. */
export function isSpotForecastStale(
  cached: { fetchedAt: number } | undefined,
  now: number = Date.now(),
): boolean {
  return !cached || now - cached.fetchedAt > SPOT_FORECAST_TTL_MS;
}

/**
 * Fetch the 1km WRF forecast for one spot, de-duplicated and retried once.
 *
 * MeteoSIX drops 5xx in bursts, so a lone failure is usually worth one more
 * attempt. The exception is the client's own circuit breaker: once that is
 * open the retry would short-circuit instantly anyway, so we surface the
 * error immediately instead of making the user watch a spinner for 3 seconds
 * that we already know will not help.
 */
export function fetchSpotForecast(
  spotId: string,
  lat: number,
  lon: number,
): Promise<HourlyForecast[]> {
  const existing = inFlight.get(spotId);
  if (existing) return existing;

  const attempt = fetchMeteoSixForecast(lat, lon).catch((err) => {
    if ((err as Error)?.name === 'MeteoSixBreakerOpenError') throw err;
    console.debug(`[SpotForecast] ${spotId} attempt 1 failed:`, err);
    return new Promise<HourlyForecast[]>((resolve, reject) => {
      setTimeout(
        () => fetchMeteoSixForecast(lat, lon).then(resolve, reject),
        SPOT_FORECAST_RETRY_MS,
      );
    });
  });

  // Only clear our own entry: a later call may already have replaced it.
  const release = () => { if (inFlight.get(spotId) === attempt) inFlight.delete(spotId); };
  inFlight.set(spotId, attempt);
  // `then(release, release)` and NOT `.catch().finally()`: the latter adds two
  // extra microtask hops, so a caller that awaits the promise and asks again
  // immediately would still find the settled entry sitting there. Registering
  // here — before we hand the promise back — puts this ahead of the caller's
  // own continuation. Passing release as the rejection handler too keeps this
  // from surfacing as an unhandled rejection when the request fails.
  attempt.then(release, release);

  return attempt;
}
