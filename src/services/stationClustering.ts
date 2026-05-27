/**
 * Station clustering — groups close-by weather stations into cluster
 * markers at low zoom to declutter the map. At high zoom each station
 * is rendered individually.
 *
 * Triggered automatically by zoom level:
 *   - zoom >= 9.5 → no clustering, every station rendered as itself
 *   - zoom 8.5..9.5 → 3 km radius grouping
 *   - zoom < 8.5 → 6 km radius grouping (sector-level)
 *
 * Algorithm: greedy single-pass spatial clustering — pick first
 * unclaimed station as seed, absorb all neighbors within `radiusKm`,
 * repeat. Stable, deterministic, O(N²) but N is ~80-90 stations max
 * per sector so cost is ~3 ms.
 *
 * The cluster surfaces the AVERAGE temperature of the group so the
 * user can spot warm vs cold zones even when zoomed out, plus min/max
 * spread (indicates microclimate). Wind is NOT aggregated — wind
 * arrows are managed separately and have their own visibility logic.
 */
import type { NormalizedStation, NormalizedReading } from '../types/station';

export interface StationClusterPoint {
  type: 'station';
  station: NormalizedStation;
}

export interface StationClusterGroup {
  type: 'cluster';
  /** Centroid lat/lon (average of grouped stations) */
  lat: number;
  lon: number;
  /** Number of stations in the cluster */
  count: number;
  /** Average temperature (°C) — null when no station has temp data */
  avgTemp: number | null;
  /** Temperature spread (max - min, °C) — indicates microclimate variance */
  tempSpread: number | null;
  /** Worst-case (most actionable) temperature for the group — drives color */
  representativeTemp: number | null;
  /** Composite id for React key — stable per group composition */
  id: string;
  /** IDs of the stations inside the cluster (for click expansion) */
  stationIds: string[];
}

export type StationClusterItem = StationClusterPoint | StationClusterGroup;

// ── Thresholds ────────────────────────────────────────────

/** No clustering at or above this zoom — show every station individually. */
export const STATION_CLUSTER_DISABLE_ZOOM = 9.5;

/** Radius (km) used to absorb neighbors into a cluster, given the zoom. */
export function stationClusterRadiusKm(zoom: number): number {
  if (zoom >= STATION_CLUSTER_DISABLE_ZOOM) return 0;
  if (zoom >= 8.5) return 3;
  return 6;
}

// ── Distance (fast equirectangular) ───────────────────────

function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const meanLat = ((lat1 + lat2) / 2) * Math.PI / 180;
  const x = dLon * Math.cos(meanLat);
  return Math.sqrt(x * x + dLat * dLat) * R;
}

// ── Public API ────────────────────────────────────────────

/**
 * Cluster stations based on the current zoom. At high zoom returns
 * each station as a standalone point. At low zoom, groups stations
 * within `radiusKm` and aggregates their temperature into the cluster.
 *
 * @param stations  Active sector stations
 * @param readings  Map stationId → reading (for temperature aggregation)
 * @param zoom      Current map zoom level
 */
export function clusterStations(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
  zoom: number,
): StationClusterItem[] {
  const radius = stationClusterRadiusKm(zoom);
  if (radius === 0 || stations.length <= 1) {
    return stations.map((station) => ({ type: 'station' as const, station }));
  }

  const remaining = new Map(stations.map((s) => [s.id, s]));
  const result: StationClusterItem[] = [];

  for (const seed of stations) {
    if (!remaining.has(seed.id)) continue;
    remaining.delete(seed.id);

    const group: NormalizedStation[] = [seed];
    for (const candidate of Array.from(remaining.values())) {
      if (distKm(seed.lat, seed.lon, candidate.lat, candidate.lon) <= radius) {
        group.push(candidate);
        remaining.delete(candidate.id);
      }
    }

    if (group.length === 1) {
      result.push({ type: 'station', station: group[0] });
      continue;
    }

    // Aggregate temperatures
    const temps: number[] = [];
    for (const st of group) {
      const r = readings.get(st.id);
      if (r?.temperature != null && Number.isFinite(r.temperature)) {
        temps.push(r.temperature);
      }
    }

    const lat = group.reduce((s, x) => s + x.lat, 0) / group.length;
    const lon = group.reduce((s, x) => s + x.lon, 0) / group.length;
    const avgTemp = temps.length > 0 ? temps.reduce((s, x) => s + x, 0) / temps.length : null;
    const tempSpread = temps.length >= 2 ? Math.max(...temps) - Math.min(...temps) : null;
    // Representative: median for stability against outliers
    const representativeTemp = temps.length > 0
      ? temps.slice().sort((a, b) => a - b)[Math.floor(temps.length / 2)]
      : null;
    const id = 'st-cluster:' + group.map((s) => s.id).sort().join('+');

    result.push({
      type: 'cluster',
      lat,
      lon,
      count: group.length,
      avgTemp: avgTemp != null ? Math.round(avgTemp * 10) / 10 : null,
      tempSpread: tempSpread != null ? Math.round(tempSpread * 10) / 10 : null,
      representativeTemp: representativeTemp != null ? Math.round(representativeTemp * 10) / 10 : null,
      id,
      stationIds: group.map((s) => s.id),
    });
  }

  return result;
}
