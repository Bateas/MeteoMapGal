/**
 * 850 hPa wind for a sector, from our own API (the ingestor stores the model
 * sounding in upper_air_hourly every couple of hours). Feeds the synoptic
 * regime (services/synopticRegime.ts): a front aloft vetoes the thermal boosts.
 *
 * One small, cacheable GET per sector (the URL is the same for every visitor,
 * so the edge cache answers most of them). Any failure is "no data", which
 * means no veto — the boosts behave as before the regime existed.
 */
import { upperWindAt, type UpperAirLevel, type UpperWind } from '../services/synopticRegime';

/** The sector's 850 hPa hours: the last 3 and every stored hour ahead (the API returns the
 *  future rows too). Null on any failure. */
export async function fetchUpperAirLevels(
  sector: string,
  signal?: AbortSignal,
): Promise<UpperAirLevel[] | null> {
  const res = await fetch(`/api/v1/analytics/upper-air?sector=${encodeURIComponent(sector)}&hours=3`, { signal });
  if (!res.ok) return null;
  const body = (await res.json()) as { levels?: UpperAirLevel[] };
  return body.levels ?? [];
}

export async function fetchUpperWindNow(
  sector: string,
  signal?: AbortSignal,
): Promise<UpperWind | null> {
  const levels = await fetchUpperAirLevels(sector, signal);
  return levels ? upperWindAt(levels, Date.now()) : null;
}
