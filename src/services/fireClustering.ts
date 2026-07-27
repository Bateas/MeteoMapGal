/**
 * Fire clustering — collapses raw FIRMS pixels into the FIRES a person counts.
 *
 * A single wildfire produces many rows in the FIRMS feed:
 *   - two satellites (S-NPP + NOAA-20) see the same flames separately,
 *   - each satellite passes ~2x/day and the 24h window keeps every pass,
 *   - a large front spans several contiguous 375m VIIRS pixels.
 * Counting rows therefore multiplies one fire by ten or more, and the count
 * GROWS through the day as passes accumulate while nothing new is burning.
 * Every surface must speak in clusters; hotspot rows are evidence, not fires.
 *
 * Algorithm: greedy single-pass spatial clustering, same shape as
 * `spotClustering.ts` / `stationClustering.ts` — take a seed, absorb every
 * neighbour within `radiusKm`, repeat. O(N^2) with N in the low hundreds.
 *
 * Seeds are taken hottest-first (FRP desc, id as tie-break) so the result does
 * not depend on CSV row order and the strongest pixel anchors the group.
 */
import type { ActiveFire, FireConfidence } from '../types/fire';

export interface FireCluster {
  /** Stable while the group composition is stable — React key / feature id */
  id: string;
  /** FRP-weighted centroid: the most powerful pixel pulls hardest */
  lat: number;
  lon: number;
  /** Detections behind this fire. Transparency only — NEVER a fire count */
  hotspotCount: number;
  /**
   * Intensity of the fire front, in megawatts.
   *
   * Sum of the FRP of the pixels from the MOST RECENT pass only. Summing every
   * pass would add up the same fire once per overpass and per satellite, which
   * inflates intensity exactly like counting rows inflates the fire count.
   * Pixels of a single pass are different parts of one front at one instant, so
   * summing THOSE is the physically meaningful "how hard is it burning now".
   */
  frpMw: number;
  /** Most recent detection — drives freshness, and thus every "active" claim */
  latestAt: Date;
  /** Oldest detection in the group — how long it has been showing up */
  firstAt: Date;
  /** Distinct satellites that saw it. 2+ satellites (or 2+ passes) is
   *  independent corroboration, in the spirit of the project's rigour rule. */
  satellites: string[];
  /** Best confidence among the grouped detections */
  maxConfidence: FireConfidence;
  /** The grouped detections themselves */
  hotspots: ActiveFire[];
}

// ── Thresholds ────────────────────────────────────────────

/**
 * Grouping radius (km).
 *
 * Measured on the live feed during the July 2026 outbreak: the grouping is
 * STABLE from 1.0 to 3.0 km — the same three fires come out, with the same
 * 13/8/2 hotspot splits. So this is not a delicate parameter, and 2 km sits in
 * the middle of the stable band. It also comfortably spans a front several
 * 375m VIIRS pixels wide without merging genuinely separate fires.
 */
export const FIRE_CLUSTER_RADIUS_KM = 2;

/**
 * Detections this far apart in time belong to different passes.
 * One VIIRS overpass tags all its pixels with the same acquisition minute;
 * the two satellites are ~50 min apart, so 10 min isolates a single pass.
 */
const PASS_WINDOW_MS = 10 * 60_000;

/**
 * A fire may only be called ACTIVE while its newest detection is this recent.
 *
 * VIIRS gives roughly four passes a day, so ~6h means "we have had a look
 * recently". Older hotspots are real history — something burned there today —
 * but claiming they are burning NOW would be inventing data. They stay on the
 * map dimmed, with their true age, and out of every "active" count.
 */
export const FIRE_ACTIVE_MAX_MIN = 360;

/**
 * Smoke may only be drawn from detections this recent.
 * Stricter than the active gate: a plume crosses CURRENT wind with the fire's
 * position, and pairing a 20h-old hotspot with the wind blowing right now
 * paints smoke where there is none.
 */
export const FIRE_SMOKE_MAX_MIN = 180;

// ── Helpers ───────────────────────────────────────────────

const CONFIDENCE_RANK: Record<FireConfidence, number> = { low: 0, nominal: 1, high: 2 };

/** Fast equirectangular distance — plenty at a few km. */
function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const meanLat = (((lat1 + lat2) / 2) * Math.PI) / 180;
  const x = dLon * Math.cos(meanLat);
  return Math.sqrt(x * x + dLat * dLat) * R;
}

/** Minutes since the cluster was last seen from orbit. */
export function clusterAgeMin(cluster: FireCluster, now = Date.now()): number {
  return Math.max(0, (now - cluster.latestAt.getTime()) / 60_000);
}

/** Recent enough to be called an active fire. */
export function isFireActive(cluster: FireCluster, now = Date.now()): boolean {
  return clusterAgeMin(cluster, now) <= FIRE_ACTIVE_MAX_MIN;
}

/** Recent enough to cross with the wind blowing right now. */
export function canDrawSmoke(cluster: FireCluster, now = Date.now()): boolean {
  return clusterAgeMin(cluster, now) <= FIRE_SMOKE_MAX_MIN;
}

// ── Public API ────────────────────────────────────────────

/**
 * Group hotspot detections into fires.
 *
 * @param fires    Filtered FIRMS detections (see `filterRealFires`)
 * @param radiusKm Grouping radius; the result is stable across 1-3 km
 */
export function clusterFires(
  fires: ActiveFire[],
  radiusKm = FIRE_CLUSTER_RADIUS_KM,
): FireCluster[] {
  if (fires.length === 0) return [];

  // Hottest pixel seeds its group — order-independent and deterministic.
  const seeds = fires
    .slice()
    .sort((a, b) => (b.frp - a.frp) || a.id.localeCompare(b.id));

  const remaining = new Set(seeds);
  const clusters: FireCluster[] = [];

  for (const seed of seeds) {
    if (!remaining.has(seed)) continue;
    remaining.delete(seed);

    const group: ActiveFire[] = [seed];
    for (const candidate of Array.from(remaining)) {
      if (distKm(seed.lat, seed.lon, candidate.lat, candidate.lon) <= radiusKm) {
        group.push(candidate);
        remaining.delete(candidate);
      }
    }

    clusters.push(buildCluster(group));
  }

  return clusters;
}

function buildCluster(group: ActiveFire[]): FireCluster {
  // FRP-weighted centroid. All-zero FRP (possible on marginal detections)
  // would divide by zero, so fall back to the plain mean.
  const frpTotal = group.reduce((s, h) => s + (h.frp > 0 ? h.frp : 0), 0);
  let lat: number;
  let lon: number;
  if (frpTotal > 0) {
    lat = group.reduce((s, h) => s + h.lat * Math.max(0, h.frp), 0) / frpTotal;
    lon = group.reduce((s, h) => s + h.lon * Math.max(0, h.frp), 0) / frpTotal;
  } else {
    lat = group.reduce((s, h) => s + h.lat, 0) / group.length;
    lon = group.reduce((s, h) => s + h.lon, 0) / group.length;
  }

  let latest = group[0];
  let firstAt = group[0].acquiredAt;
  for (const h of group) {
    if (h.acquiredAt.getTime() > latest.acquiredAt.getTime()) latest = h;
    if (h.acquiredAt.getTime() < firstAt.getTime()) firstAt = h.acquiredAt;
  }

  // Intensity of the newest pass only — see `frpMw` doc above.
  const latestMs = latest.acquiredAt.getTime();
  const frpMw = group
    .filter(
      (h) =>
        h.satellite === latest.satellite &&
        latestMs - h.acquiredAt.getTime() <= PASS_WINDOW_MS,
    )
    .reduce((s, h) => s + Math.max(0, h.frp), 0);

  const satellites = Array.from(new Set(group.map((h) => h.satellite).filter(Boolean))).sort();

  let maxConfidence: FireConfidence = 'low';
  for (const h of group) {
    if (CONFIDENCE_RANK[h.confidence] > CONFIDENCE_RANK[maxConfidence]) {
      maxConfidence = h.confidence;
    }
  }

  return {
    id: `fire-cluster:${lat.toFixed(4)}_${lon.toFixed(4)}_${group.length}`,
    lat,
    lon,
    hotspotCount: group.length,
    frpMw: Math.round(frpMw * 100) / 100,
    latestAt: latest.acquiredAt,
    firstAt,
    satellites,
    maxConfidence,
    hotspots: group,
  };
}

// ── Shared selector ───────────────────────────────────────

/**
 * THE cluster list every surface must read.
 *
 * The hotspot array lives in the store; clustering it independently in the
 * ticker, the map and the smoke layer is how surfaces silently drift apart
 * (documented project trap). This memoises on the array reference, so all
 * callers holding the same store value get the identical cluster objects and
 * pay for the computation once per poll.
 *
 * Use this — not `clusterFires` — from components.
 */
let memoInput: ActiveFire[] | null = null;
let memoOutput: FireCluster[] = [];

export function selectFireClusters(fires: ActiveFire[]): FireCluster[] {
  if (memoInput === fires) return memoOutput;
  memoInput = fires;
  memoOutput = clusterFires(fires);
  return memoOutput;
}
