/**
 * What the embeddable widget scores from, in three requests to our own API.
 *
 * The widget used to run the whole browser discovery and then ask every network for its
 * readings, station by station, from each page that embedded it: twenty-odd requests per
 * load, eleven of them POSTs to PORTUS that no cache can hold. Several calls also passed the
 * wrong arguments, so Wunderground and Netatmo never got asked at all. The server already
 * holds the station list, the latest reading of every station and the latest buoy readings,
 * and all three answers are the same for every visitor, so the edge can serve them.
 */
import type { NormalizedReading, NormalizedStation } from '../types/station';
import type { BuoyReading } from '../api/buoyClient';
import { fetchStoredBuoys } from '../api/buoyClient';
import { fetchLatestReadings, historyToNormalized } from '../api/historyClient';
import { fetchListedStations } from '../api/stationListClient';

export interface WidgetInputs {
  stations: NormalizedStation[];
  readings: Map<string, NormalizedReading>;
  buoys: BuoyReading[];
}

/** Stations, latest readings and, for a coastal sector, buoys. Throws when there is nothing
 *  to score with; a missing buoy set only leaves the buoys out. */
export async function loadWidgetInputs(coastal: boolean): Promise<WidgetInputs> {
  const [stations, rows, buoys] = await Promise.all([
    fetchListedStations(),
    fetchLatestReadings(),
    coastal ? fetchStoredBuoys().catch(() => [] as BuoyReading[]) : Promise.resolve([] as BuoyReading[]),
  ]);
  if (!stations) throw new Error('Station list unavailable');
  const readings = new Map(historyToNormalized(rows).map((r) => [r.stationId, r]));
  return { stations, readings, buoys };
}
