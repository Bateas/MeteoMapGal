/**
 * The station list our own server keeps (`/api/v1/stations/list`).
 *
 * The server runs discovery for every network once an hour and stores the result, so a
 * client that needs to know which stations exist can ask once, from our domain, instead of
 * asking each network itself. Station discovery uses it for Wunderground; the embeddable
 * widget uses it for everything.
 */
import type { NormalizedStation, StationSource } from '../types/station';

/** How long after discovery last returned a station it still counts. Discovery runs hourly;
 *  three hours tolerates two missed runs before a station a network stopped listing drops. */
export const LIST_SEEN_MAX_MIN = 180;

const SOURCES: ReadonlySet<string> = new Set<StationSource>([
  'aemet', 'meteogalicia', 'meteoclimatic', 'wunderground', 'netatmo', 'skyx', 'ipma',
]);

interface ListedStation {
  station_id: string;
  source: string;
  name: string | null;
  lat: number;
  lon: number;
  altitude: number | null;
  seen_min_ago: number;
}

/**
 * Stations discovery has returned recently, optionally for one source. Null when the list
 * cannot be read or holds nothing current, so a caller with another way to find stations can
 * fall back to it. The age comes from the server, so a device with a wrong clock cannot
 * empty the list.
 */
export async function fetchListedStations(source?: StationSource): Promise<NormalizedStation[] | null> {
  try {
    const url = source ? `/api/v1/stations/list?source=${source}` : '/api/v1/stations/list';
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { stations?: ListedStation[] };
    if (!Array.isArray(data?.stations)) return null;

    const stations: NormalizedStation[] = [];
    for (const s of data.stations) {
      if (!SOURCES.has(s.source) || (source && s.source !== source)) continue;
      if (typeof s.station_id !== 'string' || s.station_id.length === 0) continue;
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon) || !(s.seen_min_ago <= LIST_SEEN_MAX_MIN)) continue;
      stations.push({
        id: s.station_id,
        source: s.source as StationSource,
        name: s.name || s.station_id,
        lat: s.lat,
        lon: s.lon,
        altitude: s.altitude ?? 0,
      });
    }
    return stations.length > 0 ? stations : null;
  } catch (err) {
    console.debug('[Stations] List from our API unavailable:', err);
    return null;
  }
}
