/**
 * AEMET for the map from our own API instead of AEMET's file of all of Spain.
 *
 * The server already polls AEMET and stores every reading (visibility included). Until
 * v2.191.3 each visitor downloaded the same 3.2 MB file (~750 KB compressed) every 5 min
 * through our proxy, and parsed it on the phone. Now: the latest reading per station from
 * /api/v1/readings/latest?source=aemet and, for the 8 regional visibility stations (outside
 * the sector too), their names and positions from /api/v1/stations/list?source=aemet.
 * An empty answer throws, so the caller falls back to the direct path as before.
 */
import type { NormalizedReading, NormalizedStation } from '../types/station';
import { fetchLatestReadings, historyToNormalized, type HistoryReading } from './historyClient';
import { fetchListedStations } from './stationListClient';

/** Galician AEMET stations with a visibility sensor (airports, lighthouses, two cities). */
export const GALICIA_VIS_IDS: ReadonlySet<string> = new Set(['1351', '1387', '1387E', '1400', '1428', '1484C', '1505', '1690A']);

export interface AemetVisibility {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  visibility: number;
  timestamp: Date;
}

/** The sector's readings and the region's visibility from the two API answers (pure, tested). */
export function aemetFromRows(
  rows: HistoryReading[],
  listed: NormalizedStation[] | null,
  sectorIds: ReadonlySet<string>,
): { readings: NormalizedReading[]; visibility: AemetVisibility[] } {
  const readings = historyToNormalized(rows).filter((r) => sectorIds.has(r.stationId));
  const where = new Map((listed ?? []).map((s) => [s.id, s]));
  const visibility: AemetVisibility[] = [];
  for (const r of rows) {
    const idema = r.station_id.replace(/^aemet_/, '');
    if (!GALICIA_VIS_IDS.has(idema)) continue;
    const v = r.visibility;
    if (v == null || !Number.isFinite(v) || v < 0 || v > 50) continue;
    const s = where.get(r.station_id);
    if (!s) continue; // no position, nothing to draw or measure distance from
    visibility.push({ stationId: r.station_id, name: s.name, lat: s.lat, lon: s.lon, visibility: v, timestamp: new Date(r.time) });
  }
  return { readings, visibility };
}

/** The station list changes at most hourly: kept for an hour per page. */
const LIST_TTL_MS = 60 * 60_000;
let listCache: { at: number; list: Promise<NormalizedStation[] | null> } | null = null;

function listedAemet(): Promise<NormalizedStation[] | null> {
  if (!listCache || Date.now() - listCache.at > LIST_TTL_MS) {
    listCache = { at: Date.now(), list: fetchListedStations('aemet') };
  }
  return listCache.list;
}

export async function fetchAemetFromApi(sectorIds: ReadonlySet<string>) {
  const [rows, listed] = await Promise.all([fetchLatestReadings(undefined, 'aemet'), listedAemet()]);
  const out = aemetFromRows(rows, listed, sectorIds);
  if (out.readings.length === 0 && out.visibility.length === 0) throw new Error('No AEMET data from ingestor');
  return out;
}

/** The same list for discovery (one request shared with the readings). */
export function fetchListedAemetStations(): Promise<NormalizedStation[] | null> {
  return listedAemet();
}

export function __clearAemetFromApiForTests(): void { listCache = null; }
