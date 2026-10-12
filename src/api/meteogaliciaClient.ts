import type { MeteoGaliciaStation, MeteoGaliciaObsEntry } from '../types/meteogalicia';
import { METEOGALICIA } from '../config/apiEndpoints';
import { latestObservationUrls, indexLatestById } from './mgLatestBatch';

/** Stations that consistently fail (500/404). Skip them to avoid wasted requests.
 * NOTE (2026-03): 10109 (Amiudal) and 19044 (Remuíño) were previously broken
 * but are now returning valid data. Removed from broken list.
 * Remuíño (19044): 10m wind, solar radiation — very valuable for thermal analysis.
 */
const BROKEN_STATIONS = new Set<number>();

/** Retry helper for transient server errors (502/503/504) */
async function fetchWithRetry(url: string, retries = 1, delayMs = 1500, timeoutMs = 5_000): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok || (res.status < 500 && res.status !== 429)) return res;
    if (attempt < retries) {
      console.warn(`[MeteoGalicia] ${res.status} on attempt ${attempt + 1}, retry in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    } else {
      return res; // return last failed response
    }
  }
  throw new Error('Unreachable');
}

/** Fetch all MeteoGalicia meteorological stations */
export async function fetchStationList(): Promise<MeteoGaliciaStation[]> {
  const CACHE_KEY = 'mg_station_list';
  const CACHE_TTL = 24 * 60 * 60 * 1000;

  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        return data;
      }
    } catch { /* corrupted cache — refetch */ }
  }

  const res = await fetchWithRetry(METEOGALICIA.stationList());
  if (!res.ok) {
    throw new Error(`MeteoGalicia station list failed: ${res.status}`);
  }

  const json = await res.json();
  const stations: MeteoGaliciaStation[] = json.listaEstacionsMeteo || [];

  localStorage.setItem(CACHE_KEY, JSON.stringify({
    data: stations,
    timestamp: Date.now(),
  }));

  return stations;
}

/** Latest 10-min observations for many stations, grouped in as few requests as possible
 *  (one for our ~50 stations; see mgLatestBatch.ts). Only used when our own API fails.
 *  Rejects only if every request failed, so the source status tells the truth. */
export async function fetchLatestForStations(stationIds: number[]): Promise<Map<number, MeteoGaliciaObsEntry>> {
  const validIds = stationIds.filter((id) => !BROKEN_STATIONS.has(id));
  const urls = latestObservationUrls(METEOGALICIA.base, validIds);
  const results = await Promise.allSettled(urls.map(async (url) => {
    const res = await fetchWithRetry(url, 1, 2000, 15_000);
    if (!res.ok) throw new Error(`MeteoGalicia observations: HTTP ${res.status}`);
    return indexLatestById(await res.json());
  }));

  if (urls.length > 0 && results.every((r) => r.status === 'rejected')) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  const map = new Map<number, MeteoGaliciaObsEntry>();
  for (const r of results) if (r.status === 'fulfilled') for (const [id, e] of r.value) map.set(id, e);
  return map;
}
