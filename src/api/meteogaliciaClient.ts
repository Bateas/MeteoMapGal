import type { MeteoGaliciaStation, MeteoGaliciaObsEntry } from '../types/meteogalicia';
import { METEOGALICIA } from '../config/apiEndpoints';

/** Stations that consistently fail (500/404). Skip them to avoid wasted requests. */
const BROKEN_STATIONS = new Set([10109, 19044]);

/** Fetch all MeteoGalicia meteorological stations */
export async function fetchStationList(): Promise<MeteoGaliciaStation[]> {
  const CACHE_KEY = 'mg_station_list';
  const CACHE_TTL = 24 * 60 * 60 * 1000;

  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_TTL) {
      return data;
    }
  }

  const res = await fetch(METEOGALICIA.stationList());
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

/** Fetch latest 10-min observations for a single station.
 *  Response: { listUltimos10min: [{ estacion, idEstacion, instanteLecturaUTC, listaMedidas: [...] }] }
 */
export async function fetchLatestObservation(stationId: number): Promise<MeteoGaliciaObsEntry | null> {
  const res = await fetch(METEOGALICIA.latestObservation(stationId));
  if (!res.ok) {
    console.warn(`MeteoGalicia observation failed for station ${stationId}: ${res.status}`);
    return null;
  }

  const json = await res.json();
  const entries: MeteoGaliciaObsEntry[] = json.listUltimos10min || [];
  return entries.length > 0 ? entries[0] : null;
}

/** Fetch latest observations for multiple stations in parallel */
export async function fetchLatestForStations(stationIds: number[]): Promise<Map<number, MeteoGaliciaObsEntry>> {
  const validIds = stationIds.filter((id) => !BROKEN_STATIONS.has(id));
  const results = await Promise.allSettled(
    validIds.map(async (id) => ({
      id,
      entry: await fetchLatestObservation(id),
    }))
  );

  const map = new Map<number, MeteoGaliciaObsEntry>();
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.entry) {
      map.set(result.value.id, result.value.entry);
    }
  }
  return map;
}
