/**
 * Gust front detector — outflow signature from approaching storms.
 *
 * Pattern observed during the Apr 28 2026 event:
 *   Porto-Vigo station marked gust 34 kt + wind 22.7 kt (ratio 1.5×) while
 *   a storm cluster was at 15 km NE moving 46 km/h SW. The gust ratio +
 *   bearing alignment + cluster proximity = textbook outflow signature
 *   of cold downdraft air spreading out ahead of the cell.
 *
 * Outflow precedes the body of the storm by 5-30 minutes — useful for
 * "the storm IS coming this way" early warning, distinct from the body
 * arrival ETA.
 *
 * This service is pure computation: takes existing readings + clusters,
 * returns annotated GustFrontDetection[] for the overlay/ticker.
 *
 * Phase 1 (visual): live detection, no persistence.
 * Phase 2 (DB): planned `gust_front_events` table for ML calibration —
 *               see `memory/pending-work.md`.
 */
import { computeBearing } from './idwInterpolation';
import type { StormCluster } from './stormTracker';
import { msToKnots } from './windUtils';

// ── Thresholds ────────────────────────────────────────────

/** Minimum gust/wind ratio to flag outflow. Calibrated from Porto-Vigo
 *  observation (1.5×). Below 1.4 the bump is normal turbulence. */
const MIN_GUST_RATIO = 1.4;

/** Max distance (km) from station to active cluster for a gust to count
 *  as outflow. Beyond this the wind bump is unrelated. */
const MAX_CLUSTER_DIST_KM = 30;

/** Bearing tolerance (deg) — wind direction must align with the bearing
 *  FROM cluster TO station ±this much. The wind pushes from the storm
 *  outward, so wind-FROM-bearing should match the from-cluster vector. */
const BEARING_TOLERANCE_DEG = 60;

/** Reading must be at most this old to be considered current. */
const MAX_READING_AGE_MIN = 20;

/** Minimum wind speed (kt) for a "gust" to be physically meaningful.
 *  Below this both wind and gust are too low for an outflow signature. */
const MIN_WIND_KT = 6;

/** Cluster must have had recent activity to produce outflow. Same threshold
 *  the storm overlay uses for "is this storm still active?". */
const MAX_CLUSTER_AGE_MIN = 15;

// ── Types ────────────────────────────────────────────────

export interface GustFrontReading {
  stationId: string;
  stationName: string;
  lat: number;
  lon: number;
  /** Wind speed in m/s (will convert to knots internally) */
  windMs: number;
  /** Wind gust in m/s */
  gustMs: number;
  /** Wind direction (degrees, meteorological "from") */
  windDirDeg: number;
  /** Reading age in minutes */
  ageMin: number;
}

export interface GustFrontDetection {
  stationId: string;
  stationName: string;
  lat: number;
  lon: number;
  /** Knots, for display */
  windKt: number;
  gustKt: number;
  /** gust / wind */
  ratio: number;
  /** Closest active cluster's id */
  clusterId: string;
  /** Distance from station to cluster center (km) */
  clusterDistKm: number;
  /** Cluster speed (km/h) — null if stationary */
  clusterSpeedKmh: number | null;
  /** Cluster bearing (deg) — null if stationary */
  clusterBearingDeg: number | null;
  /** Bearing from cluster TO station (the direction the outflow was pushing) */
  outflowBearingDeg: number;
  /** Confidence: 'high' if ratio≥1.5 + cluster<20km, else 'medium' */
  confidence: 'medium' | 'high';
}

// ── Helpers ──────────────────────────────────────────────

/** Equirectangular distance (km) — fast, accurate for short ranges. */
function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * 111.32;
  const dLon = (lon2 - lon1) * 111.32 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** Smallest absolute difference between two bearings, in degrees [0, 180]. */
function angleDiffDeg(a: number, b: number): number {
  let diff = Math.abs(a - b);
  if (diff > 180) diff = 360 - diff;
  return diff;
}

// ── Main ─────────────────────────────────────────────────

/**
 * Detect outflow gust fronts: stations near an active cluster whose gust/wind
 * ratio AND wind direction match the storm's downdraft signature.
 *
 * The wind direction is meteorological "from" — it should align with the
 * bearing FROM the cluster TO the station (the direction the outflow is
 * pushing). E.g. cluster NE of station, station wind from NE → match.
 */
export function detectGustFronts(
  readings: GustFrontReading[],
  clusters: StormCluster[],
): GustFrontDetection[] {
  // Filter clusters to only those still actively producing strikes
  const activeClusters = clusters.filter(
    (c) => c.newestAgeMin <= MAX_CLUSTER_AGE_MIN,
  );
  if (activeClusters.length === 0) return [];

  const out: GustFrontDetection[] = [];

  for (const r of readings) {
    if (r.ageMin > MAX_READING_AGE_MIN) continue;
    if (r.windMs == null || r.gustMs == null) continue;

    const windKt = msToKnots(r.windMs);
    const gustKt = msToKnots(r.gustMs);
    if (windKt < MIN_WIND_KT) continue;

    const ratio = gustKt / windKt;
    if (ratio < MIN_GUST_RATIO) continue;

    // Find closest active cluster within range
    let best: { cluster: StormCluster; dist: number } | null = null;
    for (const c of activeClusters) {
      // Use lead position (active front) when available
      const cLat = c.leadLat ?? c.lat;
      const cLon = c.leadLon ?? c.lon;
      const d = distKm(r.lat, r.lon, cLat, cLon);
      if (d > MAX_CLUSTER_DIST_KM) continue;
      if (!best || d < best.dist) best = { cluster: c, dist: d };
    }
    if (!best) continue;

    // Bearing from cluster TO station = direction outflow was pushing toward
    const cLat = best.cluster.leadLat ?? best.cluster.lat;
    const cLon = best.cluster.leadLon ?? best.cluster.lon;
    const outflowBearing = computeBearing(cLat, cLon, r.lat, r.lon);

    // Station's wind direction is "from" — match against the OPPOSITE of
    // outflow direction (since outflow goes from cluster→station, the wind
    // arrives "from cluster", so windDir ≈ outflowBearing - 180 = bearing
    // FROM station TO cluster). Use the from-station-to-cluster bearing
    // directly so the comparison is symmetric.
    const fromStationToCluster = computeBearing(r.lat, r.lon, cLat, cLon);
    const angle = angleDiffDeg(r.windDirDeg, fromStationToCluster);
    if (angle > BEARING_TOLERANCE_DEG) continue;

    const confidence: 'medium' | 'high' =
      ratio >= 1.5 && best.dist <= 20 ? 'high' : 'medium';

    out.push({
      stationId: r.stationId,
      stationName: r.stationName,
      lat: r.lat,
      lon: r.lon,
      windKt: Math.round(windKt * 10) / 10,
      gustKt: Math.round(gustKt * 10) / 10,
      ratio: Math.round(ratio * 100) / 100,
      clusterId: best.cluster.id,
      clusterDistKm: Math.round(best.dist * 10) / 10,
      clusterSpeedKmh: best.cluster.velocity?.speedKmh ?? null,
      clusterBearingDeg: best.cluster.velocity?.bearingDeg ?? null,
      outflowBearingDeg: Math.round(outflowBearing),
      confidence,
    });
  }

  // Sort by confidence high first, then by closest cluster
  out.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === 'high' ? -1 : 1;
    return a.clusterDistKm - b.clusterDistKm;
  });

  return out;
}
