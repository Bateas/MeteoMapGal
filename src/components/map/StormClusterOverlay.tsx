import { useMemo, memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useLightningStore } from '../../hooks/useLightningData';
import { useSectorStore } from '../../store/sectorStore';
import { bearingToCardinal, type StormCluster } from '../../services/stormTracker';

/**
 * Convex hull (Graham scan) for a set of 2D points.
 * Returns points in counter-clockwise order.
 */
function convexHull(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** Module-level hull cache, keyed by clusterId+strikeCount. Avoids O(n log n)
 *  recomputation on every render when the underlying strikes haven't changed.
 *  Cleared entries when strike signature mismatches — bounded by active cluster count. */
const hullCache = new Map<string, [number, number][]>();

function getCachedHull(cluster: StormCluster): [number, number][] | null {
  const points = cluster.strikePositions;
  if (points.length < 3) return null;
  const key = `${cluster.id}:${cluster.strikeCount}`;
  const cached = hullCache.get(key);
  if (cached) return cached;
  const hull = convexHull(points);
  if (hull.length < 3) return null;
  hullCache.set(key, hull);
  // Bound cache: keep ~20 most recent (clusters rarely exceed this)
  if (hullCache.size > 30) {
    const first = hullCache.keys().next().value;
    if (first) hullCache.delete(first);
  }
  return hull;
}

/** Build cluster shape from pre-computed hull + buffer expansion */
function hullToShape(
  cluster: StormCluster,
  hull: [number, number][],
  bufferKm: number,
): GeoJSON.Feature<GeoJSON.Polygon> {
  // Expand hull outward for visual buffer
  const bufDeg = bufferKm / 111.32;
  const expanded = hull.map(([lon, lat]) => {
    const dx = lon - cluster.lon;
    const dy = lat - cluster.lat;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.00001) return [lon, lat] as [number, number];
    const factor = 1 + bufDeg / dist;
    return [cluster.lon + dx * factor, cluster.lat + dy * factor] as [number, number];
  });

  // Close the ring
  const ring = [...expanded, expanded[0]];

  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      approaching: cluster.approaching ? 1 : 0,
      intensity: Math.min(cluster.strikeCount / 10, 1),
      distance: cluster.distanceToReservoir,
    },
  };
}

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/**
 * Generate a circle polygon (GeoJSON) centered at [lon, lat] with given radius in km.
 * Uses 64 segments for smoothness.
 */
function circlePolygon(
  lon: number,
  lat: number,
  radiusKm: number,
  segments = 64,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    const dLat = (radiusKm / 111.32) * Math.cos(angle);
    const dLon =
      (radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180))) *
      Math.sin(angle);
    coords.push([lon + dLon, lat + dLat]);
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] },
    properties: {},
  };
}

/**
 * Generate velocity arrow as a LineString from cluster centroid
 * in the direction of movement, length proportional to speed.
 */
/**
 * How far ahead (km) to project the storm given its current velocity.
 * Used by both `velocityArrow` and `arrowTip`. Represents ~30 minutes of
 * forecast at current speed, with a minimum of 6 km so even slow storms show
 * a visible direction indicator, and a maximum of 25 km to prevent fast-
 * moving outlier vectors from dominating the map.
 */
function projectionLengthKm(speedKmh: number): number {
  return Math.max(6, Math.min((speedKmh / 60) * 30, 25));
}

function velocityArrow(cluster: StormCluster): GeoJSON.Feature<GeoJSON.LineString> | null {
  if (!cluster.velocity) return null;

  const { bearingDeg, speedKmh } = cluster.velocity;
  // 30-minute projection at current speed (S126+1 — was 1 km per 4 km/h, too short)
  const arrowLenKm = projectionLengthKm(speedKmh);
  const bearingRad = (bearingDeg * Math.PI) / 180;

  // Arrow originates from the LEADING-EDGE point (v2.62.1 dual-centroid model)
  // so the projection vector matches what the velocity was actually computed
  // from (lead-to-lead movement, not display centroid drift).
  const startLat = cluster.leadLat ?? cluster.lat;
  const startLon = cluster.leadLon ?? cluster.lon;

  const endLat = startLat + (arrowLenKm / 111.32) * Math.cos(bearingRad);
  const endLon =
    startLon +
    (arrowLenKm / (111.32 * Math.cos((startLat * Math.PI) / 180))) *
      Math.sin(bearingRad);

  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [startLon, startLat],
        [endLon, endLat],
      ],
    },
    properties: {
      approaching: cluster.approaching ? 1 : 0,
      speedKmh: cluster.velocity.speedKmh,
    },
  };
}

/**
 * Arrow tip (triangle) as a small polygon at the end of velocity arrow.
 */
function arrowTip(cluster: StormCluster): GeoJSON.Feature<GeoJSON.Polygon> | null {
  if (!cluster.velocity) return null;

  const { bearingDeg, speedKmh } = cluster.velocity;
  const arrowLenKm = projectionLengthKm(speedKmh);
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const tipSizeKm = 3.5; // bigger arrowhead for visibility (was 2.5)

  // Tip point — measured from the LEADING-EDGE start (v2.62.1)
  const startLat = cluster.leadLat ?? cluster.lat;
  const startLon = cluster.leadLon ?? cluster.lon;
  const tipLat = startLat + (arrowLenKm / 111.32) * Math.cos(bearingRad);
  const tipLon =
    startLon +
    (arrowLenKm / (111.32 * Math.cos((startLat * Math.PI) / 180))) *
      Math.sin(bearingRad);

  // Two base points of the triangle (perpendicular to bearing)
  const perpRad1 = bearingRad + Math.PI / 2;
  const perpRad2 = bearingRad - Math.PI / 2;
  const backRad = bearingRad + Math.PI; // opposite direction

  // Base center (slightly behind the tip)
  const baseLat = tipLat + (tipSizeKm * 0.7 / 111.32) * Math.cos(backRad);
  const baseLon =
    tipLon +
    (tipSizeKm * 0.7 / (111.32 * Math.cos((tipLat * Math.PI) / 180))) *
      Math.sin(backRad);

  const halfBase = tipSizeKm * 0.5;
  const b1Lat = baseLat + (halfBase / 111.32) * Math.cos(perpRad1);
  const b1Lon = baseLon + (halfBase / (111.32 * Math.cos((baseLat * Math.PI) / 180))) * Math.sin(perpRad1);
  const b2Lat = baseLat + (halfBase / 111.32) * Math.cos(perpRad2);
  const b2Lon = baseLon + (halfBase / (111.32 * Math.cos((baseLat * Math.PI) / 180))) * Math.sin(perpRad2);

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [tipLon, tipLat],
        [b1Lon, b1Lat],
        [b2Lon, b2Lat],
        [tipLon, tipLat],
      ]],
    },
    properties: {
      approaching: cluster.approaching ? 1 : 0,
    },
  };
}

/**
 * Projected future path — dashed arc showing where the storm will be
 * at +5, +10, and +15 minutes along its velocity vector.
 */
function projectedPath(cluster: StormCluster): GeoJSON.Feature<GeoJSON.LineString> | null {
  if (!cluster.velocity) return null;

  const { bearingDeg, speedKmh } = cluster.velocity;
  const bearingRad = (bearingDeg * Math.PI) / 180;
  // Project from the LEADING-EDGE point so every visual indicator (trail tail,
  // velocity arrow, projected path) shares the same anchor.
  const startLat = cluster.leadLat ?? cluster.lat;
  const startLon = cluster.leadLon ?? cluster.lon;
  const coords: [number, number][] = [[startLon, startLat]];

  for (const min of [5, 10, 15, 20, 30]) {
    const distKm = (speedKmh / 60) * min;
    const lat = startLat + (distKm / 111.32) * Math.cos(bearingRad);
    const lon = startLon + (distKm / (111.32 * Math.cos((startLat * Math.PI) / 180))) * Math.sin(bearingRad);
    coords.push([lon, lat]);
  }

  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: {
      etaMinutes: cluster.etaMinutes ?? 0,
      speedKmh: cluster.velocity.speedKmh,
    },
  };
}

/**
 * ETA label at the cluster centroid for approaching storms.
 */
/** Build rich info label for EVERY cluster (on-map, no drawer needed) */
function clusterInfoPoint(cluster: StormCluster): GeoJSON.Feature<GeoJSON.Point> {
  const lines: string[] = [];

  // Line 1: storm type label (S126) — falls back to plain strike count
  // when intensity not yet enriched (first poll, no readings, etc.)
  if (cluster.intensity && cluster.intensity.type !== 'sin datos') {
    lines.push(cluster.intensity.label);
    lines.push(`${cluster.strikeCount} rayos`);
  } else {
    lines.push(`${cluster.strikeCount} rayos`);
  }

  // Line: speed + direction (if velocity known)
  if (cluster.velocity) {
    const dir = bearingToCardinal(cluster.velocity.bearingDeg);
    lines.push(`→ ${cluster.velocity.speedKmh.toFixed(0)} km/h ${dir}`);
  }

  // Line: ETA (if approaching)
  if (cluster.approaching && cluster.etaMinutes != null) {
    lines.push(`ETA ~${cluster.etaMinutes} min`);
  }

  // Line: distance
  lines.push(`${cluster.distanceToReservoir.toFixed(0)} km`);

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [cluster.lon, cluster.lat] },
    properties: {
      label: lines.join('\n'),
      approaching: cluster.approaching ? 1 : 0,
      hasVelocity: cluster.velocity ? 1 : 0,
      etaMinutes: cluster.etaMinutes ?? -1,
      distance: cluster.distanceToReservoir,
      speedKmh: cluster.velocity?.speedKmh ?? 0,
    },
  };
}

/**
 * Storm cluster visualization overlay.
 *
 * Renders on the map:
 * 1. Watch radius (50km) — faint dashed ring around reservoir
 * 2. Warning radius (25km) — subtle ring
 * 3. Danger radius (5km) — inner ring
 * 4. Storm cluster masses — gradient-filled circles showing storm extent
 * 5. Cluster centroids — pulsing markers
 * 6. Velocity arrows — direction of storm movement
 */
export const StormClusterOverlay = memo(function StormClusterOverlay() {
  const clusters = useLightningStore((s) => s.clusters);
  // strikes now carried as cluster.strikePositions (no separate store read needed)
  const showOverlay = useLightningStore((s) => s.showOverlay);
  const alertLevel = useLightningStore((s) => s.stormAlert.level);
  const clusterHistory = useLightningStore((s) => s.clusterHistory);
  const sectorCenter = useSectorStore((s) => s.activeSector.center);
  const centerLon = sectorCenter[0];
  const centerLat = sectorCenter[1];

  // ── Watch / Warning / Danger radius rings ────────────────────
  const radiusRings = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay) return EMPTY_FC;

    const features: GeoJSON.Feature[] = [];

    // Only show rings when there are active clusters or alerts
    if (alertLevel !== 'none' || clusters.length > 0) {
      // 50km watch ring
      const watch = circlePolygon(centerLon, centerLat, 80); // matches WATCH_KM in useLightningData
      watch.properties = { ring: 'watch', radius: 50 };
      features.push(watch);

      // 25km warning ring
      const warning = circlePolygon(centerLon, centerLat, 25);
      warning.properties = { ring: 'warning', radius: 25 };
      features.push(warning);

      // 5km danger ring
      const danger = circlePolygon(centerLon, centerLat, 5);
      danger.properties = { ring: 'danger', radius: 5 };
      features.push(danger);
    }

    return { type: 'FeatureCollection', features };
  }, [showOverlay, alertLevel, clusters.length, centerLon, centerLat]);

  // ── Cluster mass areas (convex hull from actual strike positions) ──
  const clusterMasses = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || clusters.length === 0) return EMPTY_FC;

    const features: GeoJSON.Feature[] = [];

    for (const cluster of clusters) {
      // Compute convex hull ONCE per cluster (cached by clusterId+strikeCount).
      // Both haze and core reuse the same hull, just different buffer expansion.
      const hull = getCachedHull(cluster);

      // Storm-intensity type drives mass-core color (S126+1) — passed as a
      // string property; the layer paint reads it via ['get', 'intensityType'].
      const intensityType = cluster.intensity?.type ?? 'unknown';

      if (hull) {
        // S126+1 polish: buffers reduced (was 8 / 3) so cluster polygons no longer
        // visually dominate when 5+ overlap. They now stay closer to the actual
        // strike footprint instead of inflating the hull by 8 km in every direction.
        const hazeShape = hullToShape(cluster, hull, 4);
        hazeShape.properties = { ...hazeShape.properties, type: 'haze', intensityType };
        features.push(hazeShape);

        const coreShape = hullToShape(cluster, hull, 1.5);
        coreShape.properties = {
          ...coreShape.properties,
          type: 'core',
          newestAgeMin: cluster.newestAgeMin,
          intensityType,
        };
        features.push(coreShape);
      } else {
        // Fallback to circle if not enough strikes for hull
        const coreRadius = Math.min(Math.max(cluster.radiusKm, 3), 12);
        const core = circlePolygon(cluster.lon, cluster.lat, coreRadius);
        core.properties = {
          type: 'core',
          approaching: cluster.approaching ? 1 : 0,
          intensity: Math.min(cluster.strikeCount / 10, 1),
          distance: cluster.distanceToReservoir,
          newestAgeMin: cluster.newestAgeMin,
          intensityType,
        };
        features.push(core);
      }
    }

    return { type: 'FeatureCollection', features };
  }, [showOverlay, clusters]);

  // ── S126 storm intensity visual differentials ────────────────
  // Two visual layers tied to cluster.intensity (set by enrichClustersWithIntensity):
  //   1. Wet-fill circle — translucent blue tint when 'lluvia intensa' detected.
  //      Says "this storm is dumping water on you, take cover" without reading text.
  //   2. Hail stripes — concentric dashed rings (ice-blue-and-white) when
  //      hailRisk === 'probable' (full atmospheric criterion). Says "this is
  //      potentially severe, granizo posible" — even more urgent than rain.
  //
  // Other types (eléctrica seca, estratiforme, mixta) keep the existing
  // visualization since their cluster label already differentiates them.

  // ── Ghost projection (S126+1) — where the storm WILL BE in 30 min ──
  // For every cluster with velocity, draw a faint outline circle at its
  // projected +30 min position. Says "this is where it's headed" as a SHAPE,
  // not just a line endpoint. The user reads the cone "current cluster →
  // ghost outline" as the storm sweeping forward.
  const projectedGhosts = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || clusters.length === 0) return EMPTY_FC;
    const features: GeoJSON.Feature[] = [];
    for (const c of clusters) {
      if (!c.velocity || c.velocity.speedKmh < 5) continue; // skip nearly-stationary
      const { bearingDeg, speedKmh } = c.velocity;
      const projKm = projectionLengthKm(speedKmh);
      const bearingRad = (bearingDeg * Math.PI) / 180;
      const startLat = c.leadLat ?? c.lat;
      const startLon = c.leadLon ?? c.lon;
      // +30 min projected center
      const futureLat = startLat + (projKm / 111.32) * Math.cos(bearingRad);
      const futureLon =
        startLon +
        (projKm / (111.32 * Math.cos((startLat * Math.PI) / 180))) *
          Math.sin(bearingRad);
      // Use a scaled-down radius — the future shape is a rough estimate, not
      // a hard prediction; show it smaller than current core to communicate
      // uncertainty.
      const ghostRadius = Math.min(Math.max(c.radiusKm * 0.7, 3), 10);
      const ring = circlePolygon(futureLon, futureLat, ghostRadius);
      ring.properties = {
        approaching: c.approaching ? 1 : 0,
        intensityType: c.intensity?.type ?? 'unknown',
        speedKmh,
      };
      features.push(ring);
    }
    return { type: 'FeatureCollection', features };
  }, [showOverlay, clusters]);

  const intensityWetFills = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || clusters.length === 0) return EMPTY_FC;
    const features: GeoJSON.Feature[] = [];
    for (const c of clusters) {
      if (c.intensity?.visualStyle !== 'wet-fill') continue;
      // Tighter than cluster radius to NOT overlap fully — reads as a "wet
      // core" within the storm cell, ~5km irrespective of cluster size.
      const radius = Math.min(Math.max(c.radiusKm * 0.7, 4), 8);
      const poly = circlePolygon(c.lon, c.lat, radius);
      poly.properties = { rate: c.intensity.rainRateMmH ?? 0 };
      features.push(poly);
    }
    return { type: 'FeatureCollection', features };
  }, [showOverlay, clusters]);

  const hailStripes = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || clusters.length === 0) return EMPTY_FC;

    // Declutter (S126+1 polish): when many clusters carry hail risk simultaneously
    // (typical of widespread events with CAPE+LI just past threshold), the
    // 3-ring halo around every single one creates a moiré pattern that drowns
    // the map. Cap at the TOP 3 by strike count — keeps the hail visual on
    // the most active cells where the risk is most concrete.
    const HAIL_RING_LIMIT = 3;
    const candidates = clusters.filter((c) => {
      const risk = c.intensity?.hailRisk;
      return risk === 'probable' || risk === 'posible';
    });
    // Sort by strikeCount desc, keep top N. Probable always wins over posible
    // at equal strike count by sorting probable-first.
    candidates.sort((a, b) => {
      const aProb = a.intensity?.hailRisk === 'probable' ? 1 : 0;
      const bProb = b.intensity?.hailRisk === 'probable' ? 1 : 0;
      if (aProb !== bProb) return bProb - aProb;
      return b.strikeCount - a.strikeCount;
    });
    const top = candidates.slice(0, HAIL_RING_LIMIT);

    const features: GeoJSON.Feature[] = [];
    for (const c of top) {
      const risk = c.intensity!.hailRisk;
      // Three concentric rings — outer/middle/inner — at fixed distance so
      // the stripe pattern reads even when cluster is small.
      // Inner is brighter, outer fades to suggest a halo effect.
      for (const km of [4, 6, 8]) {
        const ring = circlePolygon(c.leadLon ?? c.lon, c.leadLat ?? c.lat, km);
        ring.properties = { ringKm: km, risk };
        features.push(ring);
      }
    }
    return { type: 'FeatureCollection', features };
  }, [showOverlay, clusters]);

  // ── Cluster centroids (pulsing dots) ─────────────────────────
  const clusterCentroids = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || clusters.length === 0) return EMPTY_FC;

    return {
      type: 'FeatureCollection',
      features: clusters.map((c) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [c.lon, c.lat],
        },
        properties: {
          approaching: c.approaching ? 1 : 0,
          strikeCount: c.strikeCount,
          distance: c.distanceToReservoir,
          speedKmh: c.velocity?.speedKmh ?? 0,
        },
      })),
    };
  }, [showOverlay, clusters]);

  // ── Velocity arrows (split into separate collections for line vs fill layers)
  const velocityLines = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || clusters.length === 0) return EMPTY_FC;
    const features: GeoJSON.Feature[] = [];
    for (const c of clusters) {
      const arrow = velocityArrow(c);
      if (arrow) features.push(arrow);
    }
    return { type: 'FeatureCollection', features };
  }, [showOverlay, clusters]);

  const velocityTips = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || clusters.length === 0) return EMPTY_FC;
    const features: GeoJSON.Feature[] = [];
    for (const c of clusters) {
      const tip = arrowTip(c);
      if (tip) features.push(tip);
    }
    return { type: 'FeatureCollection', features };
  }, [showOverlay, clusters]);

  // ── Projected paths (approaching clusters only) ──────────
  const projectedPaths = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || clusters.length === 0) return EMPTY_FC;
    const features: GeoJSON.Feature[] = [];
    for (const c of clusters) {
      const path = projectedPath(c);
      if (path) features.push(path);
    }
    return { type: 'FeatureCollection', features };
  }, [showOverlay, clusters]);

  // ── Cluster info labels (ALL clusters — on-map, no drawer needed) ──
  const etaLabels = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || clusters.length === 0) return EMPTY_FC;
    const features: GeoJSON.Feature[] = clusters.map((c) => clusterInfoPoint(c));
    return { type: 'FeatureCollection', features };
  }, [showOverlay, clusters]);

  // ── Storm trail history (fading previous centroid positions) ──
  // Two GeoJSON sources:
  //   trailLines  → LineString per cluster ID through historical centroids +
  //                 current position. Visually shows the storm's trajectory.
  //   trailPoints → fading dots at past positions (kept for ghost-like effect
  //                 at each snapshot tick, layered on top of the line).
  const { trailLines, trailPoints } = useMemo<{
    trailLines: GeoJSON.FeatureCollection;
    trailPoints: GeoJSON.FeatureCollection;
  }>(() => {
    if (!showOverlay || clusterHistory.length <= 1) {
      return { trailLines: EMPTY_FC, trailPoints: EMPTY_FC };
    }

    const now = Date.now();

    // Group all centroids by cluster ID across history snapshots.
    type Pos = { ts: number; lat: number; lon: number; strikeCount: number };
    const byId = new Map<string, Pos[]>();
    for (const snap of clusterHistory) {
      for (const c of snap.centroids) {
        if (!byId.has(c.id)) byId.set(c.id, []);
        byId.get(c.id)!.push({
          ts: snap.timestamp, lat: c.lat, lon: c.lon, strikeCount: c.strikeCount,
        });
      }
    }
    // Append the CURRENT cluster centroid so the trail line connects all the
    // way to "now". Without this the line stops at the previous poll position.
    for (const c of clusters) {
      if (!byId.has(c.id)) byId.set(c.id, []);
      byId.get(c.id)!.push({
        ts: now, lat: c.leadLat ?? c.lat, lon: c.leadLon ?? c.lon, strikeCount: c.strikeCount,
      });
    }

    const lineFeatures: GeoJSON.Feature[] = [];
    const pointFeatures: GeoJSON.Feature[] = [];

    for (const [id, positions] of byId) {
      if (positions.length < 2) continue;
      positions.sort((a, b) => a.ts - b.ts);

      // Length-of-trail in km (sum of segment distances) — useful for the line
      // width to scale with how far the storm has moved.
      let trailKm = 0;
      for (let i = 1; i < positions.length; i++) {
        const a = positions[i - 1], b = positions[i];
        const dLat = (b.lat - a.lat) * 111.32;
        const dLon = (b.lon - a.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
        trailKm += Math.hypot(dLat, dLon);
      }

      lineFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: positions.map((p) => [p.lon, p.lat]),
        },
        properties: {
          id,
          points: positions.length,
          trailKm: Math.round(trailKm * 10) / 10,
        },
      });

      // Drop a fading dot at every PAST position (skip last = current centroid)
      for (let i = 0; i < positions.length - 1; i++) {
        const p = positions[i];
        const ageMin = (now - p.ts) / 60_000;
        const ageFactor = Math.min(ageMin / 15, 1);
        pointFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: {
            age: ageFactor,
            strikeCount: p.strikeCount,
          },
        });
      }
    }

    return {
      trailLines: { type: 'FeatureCollection', features: lineFeatures },
      trailPoints: { type: 'FeatureCollection', features: pointFeatures },
    };
  }, [showOverlay, clusterHistory, clusters]);

  if (!showOverlay) return null;

  return (
    <>
      {/* ── Radius rings ─────────────────────────────────────── */}
      <Source id="storm-radius-rings" type="geojson" data={radiusRings}>
        <Layer
          id="storm-ring-fill"
          type="fill"
          filter={['==', ['get', 'ring'], 'danger']}
          paint={{
            'fill-color': 'rgba(239, 68, 68, 0.04)',
            'fill-antialias': true,
          }}
        />
        {/* Glow halos — wider, semi-transparent lines behind the main rings */}
        <Layer
          id="storm-ring-glow-watch"
          type="line"
          filter={['==', ['get', 'ring'], 'watch']}
          paint={{
            'line-color': 'rgba(234, 179, 8, 0.08)',
            'line-width': 6,
            'line-blur': 4,
          }}
        />
        <Layer
          id="storm-ring-glow-warning"
          type="line"
          filter={['==', ['get', 'ring'], 'warning']}
          paint={{
            'line-color': 'rgba(249, 115, 22, 0.12)',
            'line-width': 8,
            'line-blur': 5,
          }}
        />
        <Layer
          id="storm-ring-glow-danger"
          type="line"
          filter={['==', ['get', 'ring'], 'danger']}
          paint={{
            'line-color': 'rgba(239, 68, 68, 0.15)',
            'line-width': 10,
            'line-blur': 6,
          }}
        />
        {/* Main dashed rings on top of glow */}
        <Layer
          id="storm-ring-line-watch"
          type="line"
          filter={['==', ['get', 'ring'], 'watch']}
          paint={{
            'line-color': 'rgba(234, 179, 8, 0.25)',
            'line-width': 1,
            'line-dasharray': [6, 4],
          }}
        />
        <Layer
          id="storm-ring-line-warning"
          type="line"
          filter={['==', ['get', 'ring'], 'warning']}
          paint={{
            'line-color': 'rgba(249, 115, 22, 0.35)',
            'line-width': 1.5,
            'line-dasharray': [4, 3],
          }}
        />
        <Layer
          id="storm-ring-line-danger"
          type="line"
          filter={['==', ['get', 'ring'], 'danger']}
          paint={{
            'line-color': 'rgba(239, 68, 68, 0.5)',
            'line-width': 2,
            'line-dasharray': [3, 2],
          }}
        />
      </Source>

      {/* ── Cluster masses (haze + core) ─────────────────────── */}
      {/* S126+1 polish: opacities lowered (~30%) because translucent fills
           COMPOUND when clusters overlap. With 5+ active cells the previous
           values stacked to near-opaque red over a wide area, drowning the
           base map. New values keep each individual cluster legible while
           letting overlap regions stay readable instead of going opaque. */}
      <Source id="storm-cluster-masses" type="geojson" data={clusterMasses}>
        {/* Outer haze — dark purple/red diffused area */}
        <Layer
          id="storm-mass-haze"
          type="fill"
          filter={['==', ['get', 'type'], 'haze']}
          paint={{
            'fill-color': [
              'case',
              ['==', ['get', 'approaching'], 1],
              'rgba(220, 38, 38, 0.09)',  // red-ish for approaching (was 0.14)
              'rgba(139, 92, 246, 0.06)', // purple for others (was 0.10)
            ],
            'fill-antialias': true,
          }}
        />
        {/* Inner core — color now driven by storm intensity TYPE when known
             (S126+1), with age as a fallback. This way "estratiforme leve"
             reads cool/blue while "lluvia intensa" reads warm/red — distinct
             at a glance even before reading the label. */}
        <Layer
          id="storm-mass-core"
          type="fill"
          filter={['==', ['get', 'type'], 'core']}
          paint={{
            'fill-color': [
              'match', ['coalesce', ['get', 'intensityType'], 'unknown'],
              'lluvia intensa',     'rgba(220, 38, 38, 0.22)',   // red, danger
              'lluvia con rayos',   'rgba(249, 115, 22, 0.18)',  // orange
              'eléctrica seca',     'rgba(234, 179, 8, 0.14)',   // amber/yellow
              'estratiforme leve',  'rgba(96, 165, 250, 0.10)',  // cool blue, low alarm
              'mixta',              'rgba(168, 85, 247, 0.16)',  // purple
              // unknown / not-yet-classified → gentle age-based fade
              [
                'interpolate', ['linear'], ['get', 'newestAgeMin'],
                0,  'rgba(239, 68, 68, 0.18)',
                15, 'rgba(249, 115, 22, 0.13)',
                30, 'rgba(168, 85, 247, 0.08)',
                60, 'rgba(100, 116, 139, 0.04)',
              ],
            ],
            'fill-antialias': true,
          }}
        />
        <Layer
          id="storm-mass-core-outline"
          type="line"
          filter={['==', ['get', 'type'], 'core']}
          paint={{
            'line-color': [
              'case',
              ['==', ['get', 'approaching'], 1],
              'rgba(239, 68, 68, 0.40)',  // was 0.50
              'rgba(168, 85, 247, 0.25)', // was 0.35
            ],
            'line-width': 2,
            'line-dasharray': [3, 2],
          }}
        />
      </Source>

      {/* ── Ghost projection (+30 min) — where the storm will be ───── */}
      {/* S126+1: faint dashed circle at the projected +30 min position of every
           moving cluster. Reads as "the storm sweeping forward" together with the
           velocity arrow — current cluster mass + arrow + ghost outline = trajectory. */}
      <Source id="storm-projected-ghosts" type="geojson" data={projectedGhosts}>
        <Layer
          id="storm-projected-fill"
          type="fill"
          paint={{
            'fill-color': [
              'case',
              ['==', ['get', 'approaching'], 1],
              'rgba(239, 68, 68, 0.10)',  // soft red — approaching: warning hint
              'rgba(168, 85, 247, 0.06)', // very soft purple — moving away
            ],
            'fill-antialias': true,
          }}
        />
        <Layer
          id="storm-projected-outline"
          type="line"
          paint={{
            'line-color': [
              'case',
              ['==', ['get', 'approaching'], 1],
              'rgba(239, 68, 68, 0.55)',
              'rgba(168, 85, 247, 0.40)',
            ],
            'line-width': 2,
            'line-dasharray': [2, 3],
            'line-opacity': 0.85,
          }}
        />
      </Source>

      {/* ── S126: Wet-fill (lluvia intensa) — translucent blue core ─── */}
      {/* S126+1 polish: more prominent — wet-fill is the "this storm is dumping
           water on you" signal, and was getting drowned by the orange/red mass-core
           underneath. Higher opacity floor, stronger outline, sized to read clearly. */}
      <Source id="storm-intensity-wet" type="geojson" data={intensityWetFills}>
        <Layer
          id="storm-intensity-wet-fill"
          type="fill"
          paint={{
            'fill-color': '#3b82f6',
            'fill-opacity': [
              'interpolate', ['linear'], ['get', 'rate'],
              0, 0.30,   // was 0.18 — even light "lluvia intensa" reads clearly
              10, 0.42,  // was 0.28
              25, 0.55,  // was 0.38
              50, 0.65,  // was 0.48
            ],
            'fill-antialias': true,
          }}
        />
        {/* Inner glow halo — soft blue around the wet zone — adds depth + draws eye */}
        <Layer
          id="storm-intensity-wet-glow"
          type="line"
          paint={{
            'line-color': 'rgba(59, 130, 246, 0.45)',
            'line-width': 6,
            'line-blur': 4,
          }}
        />
        {/* Solid outline — high contrast against orange/red mass-core underneath */}
        <Layer
          id="storm-intensity-wet-outline"
          type="line"
          paint={{
            'line-color': '#1e40af', // blue-800 — saturated, readable on warm bg
            'line-width': 2.5,        // was 1.5 — thicker
            'line-opacity': 0.9,
            'line-dasharray': [4, 2], // dashed → reads as "rain zone" rather than border
          }}
        />
      </Source>

      {/* ── S126: Hail stripes — ice-blue dashed rings on probable/posible granizo ── */}
      <Source id="storm-intensity-hail" type="geojson" data={hailStripes}>
        {/* Outer halo glow — soft, wide, low-opacity for depth */}
        <Layer
          id="storm-intensity-hail-glow"
          type="line"
          paint={{
            'line-color': 'rgba(186, 230, 253, 0.30)',
            'line-width': 8,
            'line-blur': 4,
          }}
        />
        {/* Striped ring on top — alternating dash pattern for "ice/granizo" feel */}
        <Layer
          id="storm-intensity-hail-stripes"
          type="line"
          paint={{
            // Color varies by risk level: probable = stronger cyan, posible = lighter
            'line-color': [
              'match', ['get', 'risk'],
              'probable', 'rgba(56, 189, 248, 0.95)',
              'posible',  'rgba(186, 230, 253, 0.75)',
              'rgba(186, 230, 253, 0.6)',
            ],
            // Inner ring (4km) thicker; outer rings (6, 8km) thinner
            'line-width': [
              'match', ['get', 'ringKm'],
              4, 2.5,
              6, 1.8,
              8, 1.2,
              1.5,
            ],
            // Dashed pattern reads as "stripes" / icy bands
            'line-dasharray': [3, 3],
          }}
        />
      </Source>

      {/* ── Velocity arrow shafts (LineString source) ─────────── */}
      <Source id="storm-velocity-lines" type="geojson" data={velocityLines}>
        {/* Arrow shaft glow (wider, semi-transparent for glow effect) */}
        <Layer
          id="storm-velocity-glow"
          type="line"
          paint={{
            'line-color': [
              'case',
              ['==', ['get', 'approaching'], 1],
              'rgba(239, 68, 68, 0.3)',
              'rgba(167, 139, 250, 0.2)',
            ],
            'line-width': 8,
            'line-blur': 3,
          }}
        />
        {/* Arrow shaft (solid core) */}
        <Layer
          id="storm-velocity-line"
          type="line"
          paint={{
            'line-color': '#f97316', // orange — consistent, visible on both dark and purple backgrounds
            'line-width': 3.5,
            'line-opacity': 0.9,
          }}
        />
      </Source>

      {/* ── Velocity arrow tips (Polygon source) ─────────────── */}
      <Source id="storm-velocity-tips" type="geojson" data={velocityTips}>
        <Layer
          id="storm-velocity-tip"
          type="fill"
          paint={{
            'fill-color': 'rgba(249, 115, 22, 0.85)', // orange — matches shaft
          }}
        />
      </Source>

      {/* ── Storm trajectory LINE (where the storm came from → now) ── */}
      {/* One LineString per cluster ID, connecting all historical centroids
          plus the current position. Makes movement visually obvious — you
          see the storm "trail" pointing back to where it started. */}
      <Source id="storm-trail-lines" type="geojson" data={trailLines}>
        {/* Soft glow underlay — wider, blurred, low opacity */}
        <Layer
          id="storm-trail-line-glow"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': 'rgba(168, 85, 247, 0.35)',
            'line-width': 8,
            'line-blur': 4,
          }}
        />
        {/* Solid trail line — bright purple dashed so it reads as "history" */}
        <Layer
          id="storm-trail-line-core"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': '#a855f7', // purple-500 — distinct from orange velocity arrow
            'line-width': 2.5,
            'line-opacity': 0.85,
            'line-dasharray': [3, 2],
          }}
        />
      </Source>

      {/* ── Storm trail history (fading ghost positions at each snapshot) ── */}
      <Source id="storm-trail-points" type="geojson" data={trailPoints}>
        {/* Ghost glow */}
        <Layer
          id="storm-trail-glow"
          type="circle"
          paint={{
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['get', 'age'],
              0, 10,
              1, 4,
            ],
            'circle-color': 'rgba(168, 85, 247, 0.15)',
            'circle-blur': 1,
          }}
        />
        {/* Ghost core dot */}
        <Layer
          id="storm-trail-core"
          type="circle"
          paint={{
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['get', 'age'],
              0, 4,
              1, 2,
            ],
            'circle-color': [
              'interpolate',
              ['linear'],
              ['get', 'age'],
              0, 'rgba(168, 85, 247, 0.6)',
              0.5, 'rgba(168, 85, 247, 0.3)',
              1, 'rgba(100, 116, 139, 0.1)',
            ],
            'circle-stroke-width': 0.5,
            'circle-stroke-color': 'rgba(168, 85, 247, 0.2)',
          }}
        />
      </Source>

      {/* ── Cluster centroids ────────────────────────────────── */}
      <Source id="storm-centroids" type="geojson" data={clusterCentroids}>
        {/* Outer glow pulse */}
        <Layer
          id="storm-centroid-glow"
          type="circle"
          paint={{
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['get', 'strikeCount'],
              2, 16,
              10, 24,
              20, 32,
            ],
            'circle-color': [
              'case',
              ['==', ['get', 'approaching'], 1],
              'rgba(239, 68, 68, 0.15)',
              'rgba(168, 85, 247, 0.12)',
            ],
            'circle-blur': 1,
          }}
        />
        {/* Core centroid marker */}
        <Layer
          id="storm-centroid-core"
          type="circle"
          paint={{
            'circle-radius': 6,
            'circle-color': [
              'case',
              ['==', ['get', 'approaching'], 1],
              '#dc2626',
              '#7c3aed',
            ],
            'circle-opacity': 0.9,
            'circle-stroke-width': 2,
            'circle-stroke-color': 'rgba(255, 255, 255, 0.4)',
          }}
        />
      </Source>

      {/* ── Projected storm paths (dashed future trajectory) ── */}
      <Source id="storm-projected-paths" type="geojson" data={projectedPaths}>
        <Layer
          id="storm-projected-path-glow"
          type="line"
          paint={{
            'line-color': 'rgba(249, 115, 22, 0.15)',
            'line-width': 12,
            'line-blur': 4,
          }}
        />
        <Layer
          id="storm-projected-path-line"
          type="line"
          paint={{
            'line-color': 'rgba(249, 115, 22, 0.6)',
            'line-width': 2,
            'line-dasharray': [4, 4],
          }}
        />
      </Source>

      {/* ── Cluster info labels (on-map, always visible) ──── */}
      <Source id="storm-eta-labels" type="geojson" data={etaLabels}>
        <Layer
          id="storm-info-text"
          type="symbol"
          layout={{
            'text-field': ['get', 'label'],
            'text-font': ['Noto Sans Bold'],
            'text-size': 12,
            'text-offset': [0, -2.5],
            'text-allow-overlap': true,
            'text-anchor': 'bottom',
            'text-line-height': 1.3,
          }}
          paint={{
            'text-color': [
              'case',
              ['==', ['get', 'approaching'], 1], '#fbbf24',
              '#c084fc',
            ],
            'text-halo-color': 'rgba(0, 0, 0, 0.9)',
            'text-halo-width': 2,
          }}
        />
      </Source>
    </>
  );
});
