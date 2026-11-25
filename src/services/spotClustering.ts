/**
 * Spot clustering — groups spatially-close spots into cluster markers
 * at low zoom so the map does not pile dozens of overlapping icons in
 * the same ría.
 *
 * Triggered automatically by zoom level:
 *   - zoom >= 10  → no clustering, every spot rendered as itself
 *   - zoom 9..10  → 8 km radius grouping (one cluster per ría)
 *   - zoom < 9    → 15 km radius grouping (sector-level)
 *
 * Algorithm is greedy single-pass: pick first unclaimed spot as seed,
 * absorb all spots within `radiusKm`, repeat. Stable for small N (we
 * have ~10 spots per sector) and predictable across re-renders.
 *
 * A group carries no verdict: «the worst» of a list of wind verdicts was just the windiest, and a surf spot
 * does not even have one. It stays neutral and speaks only about a real danger (spotDanger).
 */
import type { SailingSpot } from '../config/spots';

export interface SpotClusterPoint {
  type: 'spot';
  spot: SailingSpot;
}

export interface SpotClusterGroup {
  type: 'cluster';
  /** Centroid lat/lon (average of grouped spots) */
  lat: number;
  lon: number;
  /** Number of spots in the cluster */
  count: number;
  /** All spots inside the cluster */
  spots: SailingSpot[];
  /** Composite id used as React key — stable per group composition */
  id: string;
}

export type SpotClusterItem = SpotClusterPoint | SpotClusterGroup;

// ── Threshold ──────────────────────────────────────────────

/** No clustering at or above this zoom — show every spot individually. */
export const CLUSTER_DISABLE_ZOOM = 10;

/** Radius (km) used to absorb neighbors into a cluster, given the zoom. */
export function clusterRadiusKm(zoom: number): number {
  if (zoom >= CLUSTER_DISABLE_ZOOM) return 0;
  if (zoom >= 9) return 8;
  return 15;
}

// ── Danger ─────────────────────────────────────────────

/** What can close a spot for real: lightning on top of it, or the engine's hard gates. */
export type SpotDanger = 'rayos' | 'viento' | 'oleaje';

/** The danger of a spot, if any. Not «FUERTE»: that is a verdict, and for many sailors a good day. */
export function spotDanger(
  score: { provisional?: boolean; hardGateKind?: 'wind' | 'wave' | null } | undefined,
  lightning: boolean,
): SpotDanger | null {
  if (lightning) return 'rayos';
  if (!score || score.provisional || !score.hardGateKind) return null;
  return score.hardGateKind === 'wave' ? 'oleaje' : 'viento';
}

// ── Distance (fast equirectangular, sufficient for clustering) ─

function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const meanLat = ((lat1 + lat2) / 2) * Math.PI / 180;
  const x = dLon * Math.cos(meanLat);
  return Math.sqrt(x * x + dLat * dLat) * R;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Cluster a list of spots based on the current zoom.
 * Returns a heterogeneous list of either standalone spots or cluster
 * groups, in the order the renderer should paint them.
 *
 * @param spots    All spots in the active sector
 * @param zoom     Current map zoom level
 */
export function clusterSpots(
  spots: SailingSpot[],
  zoom: number,
): SpotClusterItem[] {
  const radius = clusterRadiusKm(zoom);
  if (radius === 0 || spots.length <= 1) {
    return spots.map((spot) => ({ type: 'spot' as const, spot }));
  }

  const remaining = new Map(spots.map((s) => [s.id, s]));
  const result: SpotClusterItem[] = [];

  for (const seed of spots) {
    if (!remaining.has(seed.id)) continue;
    remaining.delete(seed.id);

    const group: SailingSpot[] = [seed];
    for (const candidate of Array.from(remaining.values())) {
      if (distKm(seed.center[1], seed.center[0], candidate.center[1], candidate.center[0]) <= radius) {
        group.push(candidate);
        remaining.delete(candidate.id);
      }
    }

    if (group.length === 1) {
      result.push({ type: 'spot', spot: group[0] });
      continue;
    }

    const lat = group.reduce((s, x) => s + x.center[1], 0) / group.length;
    const lon = group.reduce((s, x) => s + x.center[0], 0) / group.length;
    const id = 'cluster:' + group.map((s) => s.id).sort().join('+');

    result.push({
      type: 'cluster',
      lat,
      lon,
      count: group.length,
      spots: group,
      id,
    });
  }

  return result;
}
