/**
 * Measured exposure of each land station (/api/v1/stations/exposure, from the nightly
 * station_calibration): how much of the free stream it reads, overall and per 45° sector.
 * The wind arrows weigh each station by it. One request an hour, shared by every caller;
 * on failure the arrows keep weighing every station alike, as before.
 */
import type { StationExposureMap } from '../services/idwInterpolation';

const TTL_MS = 60 * 60_000;
let cached: { at: number; promise: Promise<StationExposureMap> } | null = null;

interface ExposureRow {
  station_id: string;
  ratio: number | null;
  sectors: { sector: number; ratio: number }[];
}

export function fetchStationExposure(): Promise<StationExposureMap> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.promise;
  const promise = (async () => {
    const res = await fetch('/api/v1/stations/exposure');
    if (!res.ok) throw new Error(`exposure ${res.status}`);
    const data = (await res.json()) as { stations?: ExposureRow[] };
    const map: StationExposureMap = new Map();
    for (const row of data.stations ?? []) {
      const sectors: (number | null)[] = Array(8).fill(null);
      for (const s of row.sectors ?? []) {
        if (Number.isInteger(s.sector) && s.sector >= 0 && s.sector < 8 && Number.isFinite(s.ratio)) sectors[s.sector] = s.ratio;
      }
      map.set(row.station_id, { ratio: row.ratio != null && Number.isFinite(row.ratio) ? row.ratio : null, sectors });
    }
    return map;
  })().catch((err) => {
    console.debug('[stationExposure] fetch failed:', (err as Error).message);
    cached = null; // retry on the next call instead of keeping the failure for an hour
    return new Map() as StationExposureMap;
  });
  cached = { at: Date.now(), promise };
  return promise;
}

/** Tests only: the module cache outlives a test. */
export function __clearStationExposureCacheForTests(): void {
  cached = null;
}
