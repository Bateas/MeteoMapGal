import type { LightningStrike } from '../types/lightning';
import { distanceKm } from '../api/lightningClient';

/**
 * Storm cell tracking engine.
 *
 * 1. Clusters nearby strikes using a simple radius-based algorithm.
 * 2. Computes centroid, radius, and intensity of each cluster.
 * 3. Tracks clusters across successive polls to compute velocity vectors.
 * 4. Projects trajectory forward to estimate ETA to reservoir.
 */

// ── Configuration ────────────────────────────────────────────────

/** Max distance between strikes in the same cluster (km) */
const CLUSTER_RADIUS_KM = 20;

/** Minimum strikes to form a cluster */
const MIN_CLUSTER_SIZE = 2;

/** Only use strikes from the last N minutes for clustering */
const CLUSTER_WINDOW_MIN = 60;

/** Max time window for velocity computation (between two polls) */
const MAX_VELOCITY_AGE_MS = 15 * 60 * 1000; // 15 min

// ── Types ────────────────────────────────────────────────────────

export interface StormCluster {
  id: string;
  /** Centroid latitude */
  lat: number;
  /** Centroid longitude */
  lon: number;
  /** Number of strikes in the cluster */
  strikeCount: number;
  /** Radius of the cluster in km */
  radiusKm: number;
  /** Max peak current in kA */
  maxPeakCurrent: number;
  /** Average age of strikes in minutes */
  avgAgeMin: number;
  /** Newest strike age in minutes */
  newestAgeMin: number;
  /** Distance from this cluster centroid to reservoir (km) */
  distanceToReservoir: number;
  /** Velocity vector (km/h) — null if not enough history */
  velocity: { speedKmh: number; bearingDeg: number } | null;
  /** Estimated time of arrival to reservoir (minutes) — null if receding or no vector */
  etaMinutes: number | null;
  /** Is the cluster moving toward the reservoir? */
  approaching: boolean;
}

export interface StormTrackerState {
  clusters: StormCluster[];
  /** History of cluster centroids for velocity computation */
  history: ClusterSnapshot[];
}

export interface ClusterSnapshot {
  timestamp: number;
  centroids: Array<{ id: string; lat: number; lon: number; strikeCount: number }>;
}

// ── Clustering ───────────────────────────────────────────────────

/**
 * Simple radius-based clustering (no library needed).
 * Groups strikes that are within CLUSTER_RADIUS_KM of each other.
 */
function clusterStrikes(
  strikes: LightningStrike[],
  reservoirLat: number,
  reservoirLon: number,
): Omit<StormCluster, 'velocity' | 'etaMinutes' | 'approaching'>[] {
  // Only recent strikes
  const recent = strikes.filter((s) => s.ageMinutes <= CLUSTER_WINDOW_MIN);
  if (recent.length === 0) return [];

  const assigned = new Set<number>();
  const clusters: Omit<StormCluster, 'velocity' | 'etaMinutes' | 'approaching'>[] = [];
  let clusterId = 0;

  for (let i = 0; i < recent.length; i++) {
    if (assigned.has(i)) continue;

    // Start a new cluster with this strike
    const members = [i];
    assigned.add(i);

    // Find all nearby strikes (BFS)
    const queue = [i];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (let j = 0; j < recent.length; j++) {
        if (assigned.has(j)) continue;
        const dist = distanceKm(
          recent[current].lat,
          recent[current].lon,
          recent[j].lat,
          recent[j].lon,
        );
        if (dist <= CLUSTER_RADIUS_KM) {
          assigned.add(j);
          members.push(j);
          queue.push(j);
        }
      }
    }

    if (members.length < MIN_CLUSTER_SIZE) continue;

    // Compute cluster properties
    const clusterStrikes = members.map((idx) => recent[idx]);
    const latSum = clusterStrikes.reduce((s, st) => s + st.lat, 0);
    const lonSum = clusterStrikes.reduce((s, st) => s + st.lon, 0);
    const centroidLat = latSum / clusterStrikes.length;
    const centroidLon = lonSum / clusterStrikes.length;

    // Radius: max distance from centroid to any strike
    let maxDist = 0;
    for (const st of clusterStrikes) {
      const d = distanceKm(centroidLat, centroidLon, st.lat, st.lon);
      if (d > maxDist) maxDist = d;
    }

    clusters.push({
      id: `storm-${++clusterId}`,
      lat: centroidLat,
      lon: centroidLon,
      strikeCount: clusterStrikes.length,
      radiusKm: Math.round(maxDist * 10) / 10,
      maxPeakCurrent: Math.max(...clusterStrikes.map((s) => Math.abs(s.peakCurrent))),
      avgAgeMin: Math.round(
        clusterStrikes.reduce((s, st) => s + st.ageMinutes, 0) / clusterStrikes.length,
      ),
      newestAgeMin: Math.min(...clusterStrikes.map((s) => s.ageMinutes)),
      distanceToReservoir: Math.round(
        distanceKm(centroidLat, centroidLon, reservoirLat, reservoirLon) * 10,
      ) / 10,
    });
  }

  // Sort by distance to reservoir (closest first)
  clusters.sort((a, b) => a.distanceToReservoir - b.distanceToReservoir);

  return clusters;
}

// ── Velocity computation ─────────────────────────────────────────

/**
 * Compute bearing between two points in degrees (0 = North, 90 = East).
 */
function computeBearing(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Match current clusters to previous snapshot and compute velocity vectors.
 * Uses nearest-centroid matching with a max distance threshold.
 */
function computeVelocities(
  currentClusters: Omit<StormCluster, 'velocity' | 'etaMinutes' | 'approaching'>[],
  history: ClusterSnapshot[],
  now: number,
  reservoirLat: number,
  reservoirLon: number,
): StormCluster[] {
  // Find the best previous snapshot (not too old, not too new)
  const validSnapshots = history.filter(
    (h) => now - h.timestamp > 60_000 && now - h.timestamp < MAX_VELOCITY_AGE_MS,
  );

  // Use the oldest valid snapshot for better velocity accuracy
  const prevSnapshot = validSnapshots.length > 0
    ? validSnapshots.reduce((oldest, s) => (s.timestamp < oldest.timestamp ? s : oldest))
    : null;

  return currentClusters.map((cluster) => {
    let velocity: StormCluster['velocity'] = null;
    let etaMinutes: number | null = null;
    let approaching = false;

    if (prevSnapshot) {
      // Find nearest previous centroid (within 50km — storms don't jump further in 15min)
      let bestMatch: (typeof prevSnapshot.centroids)[0] | null = null;
      let bestDist = 50; // max matching distance km

      for (const prev of prevSnapshot.centroids) {
        const d = distanceKm(cluster.lat, cluster.lon, prev.lat, prev.lon);
        if (d < bestDist) {
          bestDist = d;
          bestMatch = prev;
        }
      }

      if (bestMatch) {
        const dt = (now - prevSnapshot.timestamp) / 3_600_000; // hours
        const distMoved = distanceKm(bestMatch.lat, bestMatch.lon, cluster.lat, cluster.lon);
        const speedKmh = Math.round((distMoved / dt) * 10) / 10;
        const bearingDeg = Math.round(computeBearing(
          bestMatch.lat, bestMatch.lon,
          cluster.lat, cluster.lon,
        ));

        if (speedKmh > 2) { // Filter noise (< 2 km/h = stationary)
          velocity = { speedKmh, bearingDeg };

          // Is it approaching the reservoir?
          const prevDist = distanceKm(bestMatch.lat, bestMatch.lon, reservoirLat, reservoirLon);
          approaching = cluster.distanceToReservoir < prevDist;

          if (approaching && speedKmh > 0) {
            // ETA = distance / speed (in minutes)
            etaMinutes = Math.round((cluster.distanceToReservoir / speedKmh) * 60);
          }
        }
      }
    }

    return { ...cluster, velocity, etaMinutes, approaching };
  });
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Process a new set of lightning strikes:
 * 1. Cluster them
 * 2. Match with history to compute velocities
 * 3. Return updated clusters and snapshot for history
 */
export function trackStorms(
  strikes: LightningStrike[],
  previousHistory: ClusterSnapshot[],
  reservoirLat: number,
  reservoirLon: number,
): { clusters: StormCluster[]; history: ClusterSnapshot[] } {
  const now = Date.now();

  // Step 1: Cluster current strikes
  const rawClusters = clusterStrikes(strikes, reservoirLat, reservoirLon);

  // Step 2: Compute velocities by matching with history
  const clusters = computeVelocities(rawClusters, previousHistory, now, reservoirLat, reservoirLon);

  // Step 3: Add current snapshot to history (keep last 10 snapshots, ~20 min at 2-min polls)
  const snapshot: ClusterSnapshot = {
    timestamp: now,
    centroids: rawClusters.map((c) => ({
      id: c.id,
      lat: c.lat,
      lon: c.lon,
      strikeCount: c.strikeCount,
    })),
  };

  const history = [...previousHistory, snapshot]
    .filter((h) => now - h.timestamp < MAX_VELOCITY_AGE_MS)
    .slice(-10);

  return { clusters, history };
}
