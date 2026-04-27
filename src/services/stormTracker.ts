import type { LightningStrike } from '../types/lightning';
import { distanceKm } from '../api/lightningClient';
import { computeBearing } from './idwInterpolation';

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

// ── ID continuity (S124 fix) ───────────────────────────
// Module-level counter so cluster IDs survive across trackStorms calls.
// When a cluster matches a previous-snapshot centroid by position we INHERIT
// that ID (true physical continuity). Otherwise a fresh, monotonic ID is
// minted. Hull memo caches keyed on `clusterId + strikeCount` (S123 v2.56.4)
// now keep working across polls.
let nextClusterIdSeq = 0;
function mintClusterId(): string {
  return `storm-${++nextClusterIdSeq}`;
}

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
  // ID assignment is DEFERRED to computeVelocities, where we can inherit IDs
  // from matched previous-snapshot centroids. Here we mint placeholder IDs
  // that will be overwritten if a match is found.
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
      id: mintClusterId(), // provisional — overwritten on match in computeVelocities
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

// computeBearing imported from idwInterpolation.ts

/**
 * Convert bearing degrees to cardinal direction.
 */
export function bearingToCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

/**
 * Maximum centroid drift between polls used for cluster matching.
 * Bounded above by 70 km/h × MAX_VELOCITY_AGE_MS so we never match across
 * the diameter of a province.
 */
const MAX_MATCH_KM = 30;

/**
 * Greedy global assignment: sort all (current, prev) pairs by distance and
 * commit smallest first. Each side can be matched at most once.
 *
 * Avoids the failure mode where two old centroids both map to the same new
 * cluster because we evaluated them independently. With typically <5
 * clusters this O(N·M·log) is trivially cheap.
 */
function matchClustersGreedy(
  current: RawCluster[],
  prev: { id: string; lat: number; lon: number; strikeCount: number }[],
  maxDistKm: number,
): Map<number, { id: string; lat: number; lon: number; strikeCount: number }> {
  const pairs: Array<{ ci: number; pi: number; dist: number }> = [];
  for (let ci = 0; ci < current.length; ci++) {
    for (let pi = 0; pi < prev.length; pi++) {
      const d = distanceKm(current[ci].lat, current[ci].lon, prev[pi].lat, prev[pi].lon);
      if (d <= maxDistKm) pairs.push({ ci, pi, dist: d });
    }
  }
  pairs.sort((a, b) => a.dist - b.dist);

  const usedCurrent = new Set<number>();
  const usedPrev = new Set<number>();
  const matches = new Map<number, typeof prev[0]>();
  for (const p of pairs) {
    if (usedCurrent.has(p.ci) || usedPrev.has(p.pi)) continue;
    matches.set(p.ci, prev[p.pi]);
    usedCurrent.add(p.ci);
    usedPrev.add(p.pi);
  }
  return matches;
}

/**
 * Match current clusters to previous snapshot, inherit IDs for continuity,
 * and compute velocity vectors.
 *
 * S124 improvements over the original implementation:
 *   1. Greedy global matching (not per-cluster greedy) — no double assignment.
 *   2. Adaptive match threshold (MAX_MATCH_KM constant) — scales with realistic
 *      storm motion rather than the old 50km blanket.
 *   3. Multi-snapshot velocity median — robust to single-poll noise on small
 *      clusters where the centroid jitters with each new strike.
 *   4. Inherited IDs — physical continuity across polls fixes hull memoization.
 */
function computeVelocities(
  currentClusters: RawCluster[],
  history: ClusterSnapshot[],
  now: number,
  reservoirLat: number,
  reservoirLon: number,
): StormCluster[] {
  // Snapshots within the velocity window
  const validSnapshots = history.filter(
    (h) => now - h.timestamp > MIN_VELOCITY_AGE_MS && now - h.timestamp < MAX_VELOCITY_AGE_MS,
  );
  // Most recent valid snapshot — used for ID inheritance + primary velocity
  const recentSnapshot = validSnapshots.length > 0
    ? validSnapshots.reduce((newest, s) => (s.timestamp > newest.timestamp ? s : newest))
    : null;

  // Match new clusters to most recent snapshot to inherit IDs first
  const matches = recentSnapshot
    ? matchClustersGreedy(currentClusters, recentSnapshot.centroids, MAX_MATCH_KM)
    : new Map();

  return currentClusters.map((cluster, ci) => {
    let velocity: StormCluster['velocity'] = null;
    let etaMinutes: number | null = null;
    let approaching = false;
    let inheritedId: string | null = null;

    const matched = matches.get(ci);
    if (matched && recentSnapshot) {
      inheritedId = matched.id;

      // ── Multi-snapshot velocity median ──
      // For each valid snapshot that contains a centroid matching THIS cluster
      // (within MAX_MATCH_KM of the matched-most-recent position OR of the
      // current centroid), compute a candidate velocity. Take the median to
      // suppress per-poll jitter — especially important for tiny clusters.
      const candidates: Array<{ speedKmh: number; bearingDeg: number; matchTimestamp: number; matchPos: { lat: number; lon: number } }> = [];
      for (const snap of validSnapshots) {
        const snapMatches = matchClustersGreedy([cluster], snap.centroids, MAX_MATCH_KM);
        const snapMatch = snapMatches.get(0);
        if (!snapMatch) continue;
        const dt = (now - snap.timestamp) / 3_600_000;
        if (dt <= 0) continue;
        const distMoved = distanceKm(snapMatch.lat, snapMatch.lon, cluster.lat, cluster.lon);
        const speedKmh = (distMoved / dt);
        const bearingDeg = computeBearing(snapMatch.lat, snapMatch.lon, cluster.lat, cluster.lon);
        candidates.push({ speedKmh, bearingDeg, matchTimestamp: snap.timestamp, matchPos: { lat: snapMatch.lat, lon: snapMatch.lon } });
      }

      if (candidates.length > 0) {
        // Median speed & circular-mean bearing
        const speeds = candidates.map((c) => c.speedKmh).sort((a, b) => a - b);
        const medianSpeed = Math.round(speeds[Math.floor(speeds.length / 2)] * 10) / 10;
        let sumSin = 0, sumCos = 0;
        for (const c of candidates) {
          const rad = (c.bearingDeg * Math.PI) / 180;
          sumSin += Math.sin(rad);
          sumCos += Math.cos(rad);
        }
        const meanBearing = Math.round(((Math.atan2(sumSin, sumCos) * 180) / Math.PI + 360) % 360);

        // Same gate as before: small clusters need bigger min speed
        const minSpeed = cluster.strikeCount <= 3 ? 5 : 3;
        if (medianSpeed > minSpeed && medianSpeed < 70) {
          velocity = { speedKmh: medianSpeed, bearingDeg: meanBearing };

          // Approaching: distance decreasing across the longest baseline
          // we have, AND velocity bearing within 60° of reservoir vector.
          const oldestCandidate = candidates.reduce((o, c) => (c.matchTimestamp < o.matchTimestamp ? c : o));
          const bearingToReservoir = computeBearing(cluster.lat, cluster.lon, reservoirLat, reservoirLon);
          let angleDiff = Math.abs(meanBearing - bearingToReservoir);
          if (angleDiff > 180) angleDiff = 360 - angleDiff;
          const prevDist = distanceKm(oldestCandidate.matchPos.lat, oldestCandidate.matchPos.lon, reservoirLat, reservoirLon);
          const distDecreasing = cluster.distanceToReservoir < prevDist - 0.5;
          approaching = distDecreasing && angleDiff < 60;

          if (approaching && medianSpeed > 0) {
            const approachSpeed = medianSpeed * Math.cos((angleDiff * Math.PI) / 180);
            const edgeDist = Math.max(0, cluster.distanceToReservoir - cluster.radiusKm);
            etaMinutes = approachSpeed > 1 ? Math.round((edgeDist / approachSpeed) * 60) : null;
          }
        }
      }
    }

    // Inherit physical-continuity ID if matched, else keep the freshly minted one
    const id = inheritedId ?? cluster.id;
    return { ...cluster, id, velocity, etaMinutes, approaching } as StormCluster;
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
