import type { LightningStrike } from '../types/lightning';
import { distanceKm } from '../api/lightningClient';

/**
 * Storm cell tracking engine v2.
 *
 * 1. Clusters nearby strikes using BFS with diameter cap + subdivision.
 * 2. Weighted centroid (recent strikes pull centroid toward active front).
 * 3. Tracks clusters across polls to compute velocity vectors.
 * 4. Projects trajectory forward to estimate ETA to reservoir.
 * 5. Exports strike positions per cluster for overlay hull rendering.
 */

// ── Configuration ────────────────────────────────────────────────

/** Max link distance between strikes in the same cluster (km) */
const CLUSTER_RADIUS_KM = 12; // Reduced from 20 — prevents single-linkage chain merging

/** Max cluster diameter before subdivision (km) */
const MAX_CLUSTER_DIAMETER_KM = 40;

/** Minimum strikes to form a cluster */
const MIN_CLUSTER_SIZE = 2;

/** Only use strikes from the last N minutes for clustering */
const CLUSTER_WINDOW_MIN = 60;

/** Max time window for velocity computation (between two polls) */
const MAX_VELOCITY_AGE_MS = 15 * 60 * 1000; // 15 min

/** Min age of a snapshot before it can be used for velocity (prevents jitter) */
const MIN_VELOCITY_AGE_MS = 60_000; // 60 seconds

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
  /** Strike positions [lon, lat] for overlay hull rendering */
  strikePositions: [number, number][];
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

interface RawCluster {
  id: string;
  lat: number;
  lon: number;
  strikeCount: number;
  radiusKm: number;
  maxPeakCurrent: number;
  avgAgeMin: number;
  newestAgeMin: number;
  distanceToReservoir: number;
  strikePositions: [number, number][];
}

/**
 * BFS radius-based clustering with diameter cap and subdivision.
 * Groups strikes within CLUSTER_RADIUS_KM, then subdivides any
 * cluster exceeding MAX_CLUSTER_DIAMETER_KM.
 */
function clusterStrikes(
  strikes: LightningStrike[],
  reservoirLat: number,
  reservoirLon: number,
): RawCluster[] {
  // Only recent strikes
  const recent = strikes.filter((s) => s.ageMinutes <= CLUSTER_WINDOW_MIN);
  if (recent.length === 0) return [];

  const assigned = new Set<number>();
  const rawGroups: number[][] = [];

  // ── BFS single-linkage with reduced radius ──
  for (let i = 0; i < recent.length; i++) {
    if (assigned.has(i)) continue;

    const members = [i];
    assigned.add(i);

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

    if (members.length >= MIN_CLUSTER_SIZE) {
      rawGroups.push(members);
    }
  }

  // ── Subdivide oversized clusters ──
  const finalGroups: number[][] = [];
  for (const group of rawGroups) {
    subdivideCluster(group, recent, finalGroups);
  }

  // ── Build cluster objects ──
  let clusterId = 0;
  const clusters: RawCluster[] = [];

  for (const members of finalGroups) {
    const clusterStrikesArr = members.map((idx) => recent[idx]);

    // Weighted centroid: recent strikes pull centroid toward active front
    let wLat = 0, wLon = 0, wSum = 0;
    for (const st of clusterStrikesArr) {
      const weight = 1 / (1 + st.ageMinutes / 15);
      wLat += st.lat * weight;
      wLon += st.lon * weight;
      wSum += weight;
    }
    const lat = wSum > 0 ? wLat / wSum : clusterStrikesArr[0].lat;
    const lon = wSum > 0 ? wLon / wSum : clusterStrikesArr[0].lon;

    // Radius: max distance from centroid to any strike
    let maxDist = 0;
    for (const st of clusterStrikesArr) {
      const d = distanceKm(lat, lon, st.lat, st.lon);
      if (d > maxDist) maxDist = d;
    }

    clusters.push({
      id: `storm-${++clusterId}`,
      lat,
      lon,
      strikeCount: clusterStrikesArr.length,
      radiusKm: Math.round(maxDist * 10) / 10,
      maxPeakCurrent: Math.max(...clusterStrikesArr.map((s) => Math.abs(s.peakCurrent))),
      avgAgeMin: Math.round(
        clusterStrikesArr.reduce((s, st) => s + st.ageMinutes, 0) / clusterStrikesArr.length,
      ),
      newestAgeMin: Math.min(...clusterStrikesArr.map((s) => s.ageMinutes)),
      distanceToReservoir: Math.round(
        distanceKm(lat, lon, reservoirLat, reservoirLon) * 10,
      ) / 10,
      strikePositions: clusterStrikesArr.map((s) => [s.lon, s.lat] as [number, number]),
    });
  }

  // Sort by distance to reservoir (closest first)
  clusters.sort((a, b) => a.distanceToReservoir - b.distanceToReservoir);

  return clusters;
}

/**
 * Recursively subdivide a cluster if its diameter exceeds MAX_CLUSTER_DIAMETER_KM.
 * Uses k-means bisection: split along the axis of the two farthest points.
 */
function subdivideCluster(
  members: number[],
  strikes: LightningStrike[],
  output: number[][],
): void {
  if (members.length < MIN_CLUSTER_SIZE) return;

  // Find cluster diameter (farthest pair)
  let maxDist = 0;
  let farA = 0, farB = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const d = distanceKm(
        strikes[members[i]].lat, strikes[members[i]].lon,
        strikes[members[j]].lat, strikes[members[j]].lon,
      );
      if (d > maxDist) {
        maxDist = d;
        farA = i;
        farB = j;
      }
    }
  }

  // If within diameter cap, keep as-is
  if (maxDist <= MAX_CLUSTER_DIAMETER_KM) {
    output.push(members);
    return;
  }

  // Split: assign each strike to nearest of the two farthest points
  const anchorA = strikes[members[farA]];
  const anchorB = strikes[members[farB]];
  const groupA: number[] = [];
  const groupB: number[] = [];

  for (const idx of members) {
    const dA = distanceKm(strikes[idx].lat, strikes[idx].lon, anchorA.lat, anchorA.lon);
    const dB = distanceKm(strikes[idx].lat, strikes[idx].lon, anchorB.lat, anchorB.lon);
    if (dA <= dB) {
      groupA.push(idx);
    } else {
      groupB.push(idx);
    }
  }

  // Recurse on each half (may need further subdivision)
  if (groupA.length >= MIN_CLUSTER_SIZE) subdivideCluster(groupA, strikes, output);
  if (groupB.length >= MIN_CLUSTER_SIZE) subdivideCluster(groupB, strikes, output);
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
 * Convert bearing degrees to cardinal direction.
 */
export function bearingToCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

/**
 * Match current clusters to previous snapshot and compute velocity vectors.
 * Uses nearest-centroid matching with a max distance threshold.
 */
function computeVelocities(
  currentClusters: RawCluster[],
  history: ClusterSnapshot[],
  now: number,
  reservoirLat: number,
  reservoirLon: number,
): StormCluster[] {
  // Find the best previous snapshot (not too old, not too new)
  const validSnapshots = history.filter(
    (h) => now - h.timestamp > MIN_VELOCITY_AGE_MS && now - h.timestamp < MAX_VELOCITY_AGE_MS,
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
      // Find nearest previous centroid (within 50km)
      let bestMatch: (typeof prevSnapshot.centroids)[0] | null = null;
      let bestDist = 50;

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

        // Filter noise and false matches.
        // Small clusters (2-3 strikes) have very unstable centroids — require higher min speed.
        // Most Galician storms move 20-50 km/h. >70 is almost certainly a false centroid match.
        const minSpeed = cluster.strikeCount <= 3 ? 5 : 3;
        if (speedKmh > minSpeed && speedKmh < 70) {
          velocity = { speedKmh, bearingDeg };

          // Is it approaching the reservoir?
          // Use BOTH distance decrease AND bearing alignment for robust detection.
          // Bearing from cluster to reservoir:
          const bearingToReservoir = computeBearing(cluster.lat, cluster.lon, reservoirLat, reservoirLon);
          // Angular difference between movement direction and direction to reservoir:
          let angleDiff = Math.abs(bearingDeg - bearingToReservoir);
          if (angleDiff > 180) angleDiff = 360 - angleDiff;
          // Approaching = moving toward reservoir (angle < 60°) AND distance actually decreasing
          const prevDist = distanceKm(bestMatch.lat, bestMatch.lon, reservoirLat, reservoirLon);
          const distDecreasing = cluster.distanceToReservoir < prevDist - 0.5; // 0.5km hysteresis
          approaching = distDecreasing && angleDiff < 60;

          if (approaching && speedKmh > 0) {
            // ETA from cluster EDGE (not centroid) to sector center
            // Use component of velocity toward reservoir (cos of angle)
            const approachSpeed = speedKmh * Math.cos((angleDiff * Math.PI) / 180);
            const edgeDist = Math.max(0, cluster.distanceToReservoir - cluster.radiusKm);
            etaMinutes = approachSpeed > 1 ? Math.round((edgeDist / approachSpeed) * 60) : null;
          }
        }
      }
    }

    return { ...cluster, velocity, etaMinutes, approaching } as StormCluster;
  });
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Process a new set of lightning strikes:
 * 1. Cluster them (with diameter cap subdivision)
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

  // Step 1: Cluster current strikes (with subdivision)
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
