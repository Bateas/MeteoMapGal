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
  // polish: hull is computed from RECENT strikes only (≤20 min old in
  // stormTracker), so the cluster polygon hugs the active front instead of
  // including the trailing tail. Falls back to all strikes if too few recent
  // ones (handled in stormTracker.recentStrikePositions).
  const points = cluster.recentStrikePositions ?? cluster.strikePositions;
  if (points.length < 3) return null;
  // Cache key includes recent count so the hull invalidates when strikes age
  // out of the recent window even if total strikeCount is unchanged.
  const key = `${cluster.id}:${cluster.strikeCount}:${points.length}`;
  const cached = hullCache.get(key);
  if (cached) return cached;
  const hull = convexHull(points);
  if (hull.length < 3) return null;
  hullCache.set(key, hull);
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

// ── Fade-out thresholds ────────────────────────────
// Storms enter "dissipation" phase when their newest strike is older than
// DISSIPATING_AGE_MIN. At that point predictions stop being trustworthy
// (atmosphere may have changed, no ground truth lately) so we hide future-
// pointing visuals (arrow, ghost, hail rings) and dim the cluster mass.
// Past EXPIRED_AGE_MIN the cluster is essentially memory — render as a
// faint silhouette only.
const DISSIPATING_AGE_MIN = 15;
const EXPIRED_AGE_MIN = 30;
void EXPIRED_AGE_MIN; // referenced in paint expressions via numeric literal

/**
 * Returns true when the cluster has had recent enough activity to justify
 * showing prediction visuals (arrow, ghost, hail). Below this threshold the
 * predictor's velocity/atmosphere data is still operationally meaningful.
 */
function isClusterActive(c: StormCluster): boolean {
  return c.newestAgeMin <= DISSIPATING_AGE_MIN;
}

/**
 * Trail/arrow/ghost should only render when there's actual movement to show.
 * Without velocity computed (cluster matched but moved less than minSpeed
 * gate), drawing a trail line with no flecha + no ghost is incoherent.
 */
function isClusterMoving(c: StormCluster): boolean {
  return c.velocity != null;
}

/**
 * Generate a circle polygon (GeoJSON) centered at [lon, lat] with given radius in km.
 * Default segments=32 (was 64 pre-S136+3+1 — half vertices for same visual smoothness
 * at typical zoom levels; gpu cost ~50% lower in storm-pico render).
 */
function circlePolygon(
  lon: number,
  lat: number,
  radiusKm: number,
  segments = 32,
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
  // 30-minute projection at current speed (was 1 km per 4 km/h, too short)
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

/** Build rich info label for EVERY cluster (on-map, no drawer needed) */
function clusterInfoPoint(cluster: StormCluster): GeoJSON.Feature<GeoJSON.Point> {
  const lines: string[] = [];

  // Line 1: storm type label — falls back to plain strike count
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
 * Renders on the map (consolidated S136+3+1 — 12 sources → 3):
 *   - storm-polygons: rings + masses + ghosts + wet + hail + velocity tips
 *   - storm-lines: velocity shafts + trail lines + projected paths
 *   - storm-points: trail dots + centroids + ETA labels
 * Each feature carries a `kind` property used by layer filters.
 *
 * Win: -75% source updates / style diffing, -50% circlePolygon vertices
 * (segments 64→32). Probably mitigates mousemove violations 167-483ms
 * reported during active storms with 16+ clusters.
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

  // ── POLYGON SOURCE ───────────────────────────────────────────────
  // Consolidates: radiusRings + clusterMasses (haze + core) + projectedGhosts
  // + intensityWetFills + hailStripes + velocityTips.
  // Each feature tagged with `kind` ∈ {ring-watch, ring-warning, ring-danger,
  // mass-haze, mass-core, projected-ghost, wet-fill, hail-ring, velocity-tip}.
  const stormPolygons = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay) return EMPTY_FC;

    const features: GeoJSON.Feature[] = [];

    // ── Radius rings (watch 80km / warning 25km / danger 5km) ──
    // Only show when alert active or clusters present.
    if (alertLevel !== 'none' || clusters.length > 0) {
      const watch = circlePolygon(centerLon, centerLat, 80); // matches WATCH_KM in useLightningData
      watch.properties = { kind: 'ring-watch', radius: 50 };
      features.push(watch);

      const warning = circlePolygon(centerLon, centerLat, 25);
      warning.properties = { kind: 'ring-warning', radius: 25 };
      features.push(warning);

      const danger = circlePolygon(centerLon, centerLat, 5);
      danger.properties = { kind: 'ring-danger', radius: 5 };
      features.push(danger);
    }

    // ── Cluster masses (haze + core via convex hull) ──
    for (const cluster of clusters) {
      const hull = getCachedHull(cluster);
      const intensityType = cluster.intensity?.type ?? 'unknown';

      if (hull) {
        const hazeShape = hullToShape(cluster, hull, 4);
        hazeShape.properties = {
          ...hazeShape.properties,
          kind: 'mass-haze',
          intensityType,
          newestAgeMin: cluster.newestAgeMin,
        };
        features.push(hazeShape);

        const coreShape = hullToShape(cluster, hull, 1.5);
        coreShape.properties = {
          ...coreShape.properties,
          kind: 'mass-core',
          intensityType,
          newestAgeMin: cluster.newestAgeMin,
        };
        features.push(coreShape);
      } else {
        // Fallback to circle if not enough strikes for hull
        const coreRadius = Math.min(Math.max(cluster.radiusKm, 3), 12);
        const core = circlePolygon(cluster.lon, cluster.lat, coreRadius);
        core.properties = {
          kind: 'mass-core',
          approaching: cluster.approaching ? 1 : 0,
          intensity: Math.min(cluster.strikeCount / 10, 1),
          distance: cluster.distanceToReservoir,
          newestAgeMin: cluster.newestAgeMin,
          intensityType,
        };
        features.push(core);
      }
    }

    // ── Projected ghosts (+30 min) — active + moving + non-stationary ──
    for (const c of clusters) {
      if (!isClusterActive(c)) continue;
      if (!c.velocity || c.velocity.speedKmh < 5) continue;
      const { bearingDeg, speedKmh } = c.velocity;
      const projKm = projectionLengthKm(speedKmh);
      const bearingRad = (bearingDeg * Math.PI) / 180;
      const startLat = c.leadLat ?? c.lat;
      const startLon = c.leadLon ?? c.lon;
      const futureLat = startLat + (projKm / 111.32) * Math.cos(bearingRad);
      const futureLon =
        startLon +
        (projKm / (111.32 * Math.cos((startLat * Math.PI) / 180))) *
          Math.sin(bearingRad);
      const ghostRadius = Math.min(Math.max(c.radiusKm * 0.7, 3), 10);
      const ring = circlePolygon(futureLon, futureLat, ghostRadius);
      ring.properties = {
        kind: 'projected-ghost',
        approaching: c.approaching ? 1 : 0,
        intensityType: c.intensity?.type ?? 'unknown',
        speedKmh,
      };
      features.push(ring);
    }

    // ── Wet fills (lluvia intensa — wet-core within storm cell) ──
    for (const c of clusters) {
      if (c.intensity?.visualStyle !== 'wet-fill') continue;
      const radius = Math.min(Math.max(c.radiusKm * 0.7, 4), 8);
      const poly = circlePolygon(c.lon, c.lat, radius);
      poly.properties = { kind: 'wet-fill', rate: c.intensity.rainRateMmH ?? 0 };
      features.push(poly);
    }

    // ── Hail rings (top-3 active+probable/posible by strikeCount) ──
    const HAIL_RING_LIMIT = 3;
    const hailCandidates = clusters.filter((c) => {
      if (!isClusterActive(c)) return false;
      const risk = c.intensity?.hailRisk;
      return risk === 'probable' || risk === 'posible';
    });
    hailCandidates.sort((a, b) => {
      const aProb = a.intensity?.hailRisk === 'probable' ? 1 : 0;
      const bProb = b.intensity?.hailRisk === 'probable' ? 1 : 0;
      if (aProb !== bProb) return bProb - aProb;
      return b.strikeCount - a.strikeCount;
    });
    for (const c of hailCandidates.slice(0, HAIL_RING_LIMIT)) {
      const risk = c.intensity!.hailRisk;
      for (const km of [4, 6, 8]) {
        const ring = circlePolygon(c.leadLon ?? c.lon, c.leadLat ?? c.lat, km);
        ring.properties = { kind: 'hail-ring', ringKm: km, risk };
        features.push(ring);
      }
    }

    // ── Velocity tips (arrow heads — small triangle polygons) ──
    for (const c of clusters) {
      if (!isClusterActive(c) || !isClusterMoving(c)) continue;
      const tip = arrowTip(c);
      if (tip) {
        tip.properties = { ...tip.properties, kind: 'velocity-tip' };
        features.push(tip);
      }
    }

    return { type: 'FeatureCollection', features };
  }, [showOverlay, alertLevel, clusters, centerLon, centerLat]);

  // ── LINE SOURCE ─────────────────────────────────────────────────
  // Consolidates: velocityLines + projectedPaths + trailLines.
  // Each feature tagged with `kind` ∈ {velocity-shaft, projected-path, trail-line}.
  const stormLines = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay) return EMPTY_FC;

    const features: GeoJSON.Feature[] = [];

    // ── Velocity arrow shafts ──
    for (const c of clusters) {
      if (!isClusterActive(c) || !isClusterMoving(c)) continue;
      const arrow = velocityArrow(c);
      if (arrow) {
        arrow.properties = { ...arrow.properties, kind: 'velocity-shaft' };
        features.push(arrow);
      }
    }

    // ── Projected paths (dashed future trajectory) ──
    for (const c of clusters) {
      if (!isClusterActive(c) || !isClusterMoving(c)) continue;
      const path = projectedPath(c);
      if (path) {
        path.properties = { ...path.properties, kind: 'projected-path' };
        features.push(path);
      }
    }

    // ── Trail lines (history → now per moving cluster) ──
    if (clusterHistory.length > 1) {
      const now = Date.now();
      const eligibleIds = new Set<string>();
      for (const c of clusters) {
        if (isClusterMoving(c)) eligibleIds.add(c.id);
      }

      type Pos = { ts: number; lat: number; lon: number; strikeCount: number };
      const byId = new Map<string, Pos[]>();
      for (const snap of clusterHistory) {
        if (!snap.centroids) continue;
        for (const c of snap.centroids) {
          if (!eligibleIds.has(c.id)) continue;
          if (!byId.has(c.id)) byId.set(c.id, []);
          byId.get(c.id)!.push({ ts: snap.timestamp, lat: c.lat, lon: c.lon, strikeCount: c.strikeCount });
        }
      }
      const ageById = new Map<string, number>();
      for (const c of clusters) {
        if (!eligibleIds.has(c.id)) continue;
        ageById.set(c.id, c.newestAgeMin);
        if (!byId.has(c.id)) byId.set(c.id, []);
        byId.get(c.id)!.push({ ts: now, lat: c.leadLat ?? c.lat, lon: c.leadLon ?? c.lon, strikeCount: c.strikeCount });
      }

      for (const [id, positions] of byId) {
        if (positions.length < 2) continue;
        positions.sort((a, b) => a.ts - b.ts);

        let trailKm = 0;
        for (let i = 1; i < positions.length; i++) {
          const a = positions[i - 1], b = positions[i];
          const dLat = (b.lat - a.lat) * 111.32;
          const dLon = (b.lon - a.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
          trailKm += Math.hypot(dLat, dLon);
        }

        const newestAgeMin = ageById.get(id) ?? 0;
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: positions.map((p) => [p.lon, p.lat]),
          },
          properties: {
            kind: 'trail-line',
            id,
            points: positions.length,
            trailKm: Math.round(trailKm * 10) / 10,
            newestAgeMin,
          },
        });
      }
    }

    return { type: 'FeatureCollection', features };
  }, [showOverlay, clusters, clusterHistory]);

  // ── POINT SOURCE ────────────────────────────────────────────────
  // Consolidates: trailPoints + clusterCentroids + etaLabels.
  // Each feature tagged with `kind` ∈ {trail-point, centroid, label}.
  const stormPoints = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay) return EMPTY_FC;

    const features: GeoJSON.Feature[] = [];

    // ── Trail past positions (fading dots, skip last = current centroid) ──
    if (clusterHistory.length > 1) {
      const now = Date.now();
      const eligibleIds = new Set<string>();
      for (const c of clusters) {
        if (isClusterMoving(c)) eligibleIds.add(c.id);
      }
      // Drop a fading dot at every PAST position. Current position is handled
      // by the centroid layer below.
      for (const snap of clusterHistory) {
        if (!snap.centroids) continue;
        for (const c of snap.centroids) {
          if (!eligibleIds.has(c.id)) continue;
          const ageMin = (now - snap.timestamp) / 60_000;
          const ageFactor = Math.min(ageMin / 15, 1);
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
            properties: {
              kind: 'trail-point',
              age: ageFactor,
              strikeCount: c.strikeCount,
            },
          });
        }
      }
    }

    // ── Cluster centroids (pulsing dots — one per current cluster) ──
    for (const c of clusters) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: {
          kind: 'centroid',
          approaching: c.approaching ? 1 : 0,
          strikeCount: c.strikeCount,
          distance: c.distanceToReservoir,
          speedKmh: c.velocity?.speedKmh ?? 0,
        },
      });
    }

    // ── ETA labels (rich info text — one per cluster) ──
    for (const c of clusters) {
      const info = clusterInfoPoint(c);
      info.properties = { ...info.properties, kind: 'label' };
      features.push(info);
    }

    return { type: 'FeatureCollection', features };
  }, [showOverlay, clusters, clusterHistory]);

  if (!showOverlay) return null;

  return (
    <>
      {/* ── POLYGON SOURCE ─────────────────────────────────────── */}
      <Source id="storm-polygons" type="geojson" data={stormPolygons}>
        {/* ── Radius rings: fill (danger only) + glows + main lines ── */}
        <Layer
          id="storm-ring-fill"
          type="fill"
          filter={['==', ['get', 'kind'], 'ring-danger']}
          paint={{
            'fill-color': 'rgba(239, 68, 68, 0.04)',
            'fill-antialias': true,
          }}
        />
        <Layer
          id="storm-ring-glow-watch"
          type="line"
          filter={['==', ['get', 'kind'], 'ring-watch']}
          paint={{
            'line-color': 'rgba(234, 179, 8, 0.08)',
            'line-width': 6,
            'line-blur': 4,
          }}
        />
        <Layer
          id="storm-ring-glow-warning"
          type="line"
          filter={['==', ['get', 'kind'], 'ring-warning']}
          paint={{
            'line-color': 'rgba(249, 115, 22, 0.12)',
            'line-width': 8,
            'line-blur': 5,
          }}
        />
        <Layer
          id="storm-ring-glow-danger"
          type="line"
          filter={['==', ['get', 'kind'], 'ring-danger']}
          paint={{
            'line-color': 'rgba(239, 68, 68, 0.15)',
            'line-width': 10,
            'line-blur': 6,
          }}
        />
        <Layer
          id="storm-ring-line-watch"
          type="line"
          filter={['==', ['get', 'kind'], 'ring-watch']}
          paint={{
            'line-color': 'rgba(234, 179, 8, 0.25)',
            'line-width': 1,
            'line-dasharray': [6, 4],
          }}
        />
        <Layer
          id="storm-ring-line-warning"
          type="line"
          filter={['==', ['get', 'kind'], 'ring-warning']}
          paint={{
            'line-color': 'rgba(249, 115, 22, 0.35)',
            'line-width': 1.5,
            'line-dasharray': [4, 3],
          }}
        />
        <Layer
          id="storm-ring-line-danger"
          type="line"
          filter={['==', ['get', 'kind'], 'ring-danger']}
          paint={{
            'line-color': 'rgba(239, 68, 68, 0.5)',
            'line-width': 2,
            'line-dasharray': [3, 2],
          }}
        />

        {/* ── Cluster masses: haze + core fill + core outline ── */}
        <Layer
          id="storm-mass-haze"
          type="fill"
          filter={['==', ['get', 'kind'], 'mass-haze']}
          paint={{
            'fill-color': [
              'case',
              ['==', ['get', 'approaching'], 1],
              'rgba(220, 38, 38, 0.09)',
              'rgba(139, 92, 246, 0.06)',
            ],
            'fill-antialias': true,
            'fill-opacity': [
              'interpolate', ['linear'], ['coalesce', ['get', 'newestAgeMin'], 0],
              0,  1.0,
              15, 0.5,
              30, 0.2,
              60, 0.1,
            ],
          }}
        />
        <Layer
          id="storm-mass-core"
          type="fill"
          filter={['==', ['get', 'kind'], 'mass-core']}
          paint={{
            'fill-color': [
              'match', ['coalesce', ['get', 'intensityType'], 'unknown'],
              'lluvia intensa',     'rgba(220, 38, 38, 0.22)',
              'lluvia con rayos',   'rgba(249, 115, 22, 0.18)',
              'eléctrica seca',     'rgba(234, 179, 8, 0.14)',
              'estratiforme leve',  'rgba(96, 165, 250, 0.10)',
              'mixta',              'rgba(168, 85, 247, 0.16)',
              [
                'interpolate', ['linear'], ['get', 'newestAgeMin'],
                0,  'rgba(239, 68, 68, 0.18)',
                15, 'rgba(249, 115, 22, 0.13)',
                30, 'rgba(168, 85, 247, 0.08)',
                60, 'rgba(100, 116, 139, 0.04)',
              ],
            ],
            'fill-antialias': true,
            'fill-opacity': [
              'interpolate', ['linear'], ['coalesce', ['get', 'newestAgeMin'], 0],
              0,  1.0,
              15, 0.5,
              30, 0.2,
              60, 0.08,
            ],
          }}
        />
        <Layer
          id="storm-mass-core-outline"
          type="line"
          filter={['==', ['get', 'kind'], 'mass-core']}
          paint={{
            'line-color': [
              'case',
              ['==', ['get', 'approaching'], 1],
              'rgba(239, 68, 68, 0.40)',
              'rgba(168, 85, 247, 0.25)',
            ],
            'line-width': 2,
            'line-dasharray': [3, 2],
            'line-opacity': [
              'interpolate', ['linear'], ['coalesce', ['get', 'newestAgeMin'], 0],
              0,  1.0,
              15, 0.5,
              30, 0.2,
              60, 0.05,
            ],
          }}
        />

        {/* ── Projected ghosts (+30 min): fill + outline ── */}
        <Layer
          id="storm-projected-fill"
          type="fill"
          filter={['==', ['get', 'kind'], 'projected-ghost']}
          paint={{
            'fill-color': [
              'case',
              ['==', ['get', 'approaching'], 1],
              'rgba(239, 68, 68, 0.10)',
              'rgba(168, 85, 247, 0.06)',
            ],
            'fill-antialias': true,
          }}
        />
        <Layer
          id="storm-projected-outline"
          type="line"
          filter={['==', ['get', 'kind'], 'projected-ghost']}
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

        {/* ── Wet fills (lluvia intensa): fill + inner glow + outline ── */}
        <Layer
          id="storm-intensity-wet-fill"
          type="fill"
          filter={['==', ['get', 'kind'], 'wet-fill']}
          paint={{
            'fill-color': '#3b82f6',
            'fill-opacity': [
              'interpolate', ['linear'], ['get', 'rate'],
              0, 0.16,
              10, 0.24,
              25, 0.34,
              50, 0.42,
            ],
            'fill-antialias': true,
          }}
        />
        <Layer
          id="storm-intensity-wet-glow"
          type="line"
          filter={['==', ['get', 'kind'], 'wet-fill']}
          paint={{
            'line-color': 'rgba(59, 130, 246, 0.25)',
            'line-width': 5,
            'line-blur': 3,
          }}
        />
        <Layer
          id="storm-intensity-wet-outline"
          type="line"
          filter={['==', ['get', 'kind'], 'wet-fill']}
          paint={{
            'line-color': '#1e40af',
            'line-width': 1.8,
            'line-opacity': 0.65,
            'line-dasharray': [4, 2],
          }}
        />

        {/* ── Hail rings: glow + striped ring ── */}
        <Layer
          id="storm-intensity-hail-glow"
          type="line"
          filter={['==', ['get', 'kind'], 'hail-ring']}
          paint={{
            'line-color': 'rgba(186, 230, 253, 0.30)',
            'line-width': 8,
            'line-blur': 4,
          }}
        />
        <Layer
          id="storm-intensity-hail-stripes"
          type="line"
          filter={['==', ['get', 'kind'], 'hail-ring']}
          paint={{
            'line-color': [
              'match', ['get', 'risk'],
              'probable', 'rgba(56, 189, 248, 0.95)',
              'posible',  'rgba(186, 230, 253, 0.75)',
              'rgba(186, 230, 253, 0.6)',
            ],
            'line-width': [
              'match', ['get', 'ringKm'],
              4, 2.5,
              6, 1.8,
              8, 1.2,
              1.5,
            ],
            'line-dasharray': [3, 3],
          }}
        />

        {/* ── Velocity arrow tips (triangle fill) ── */}
        <Layer
          id="storm-velocity-tip"
          type="fill"
          filter={['==', ['get', 'kind'], 'velocity-tip']}
          paint={{
            'fill-color': 'rgba(249, 115, 22, 0.85)',
          }}
        />
      </Source>

      {/* ── LINE SOURCE ────────────────────────────────────────── */}
      <Source id="storm-lines" type="geojson" data={stormLines}>
        {/* ── Velocity arrow shafts: glow + solid core ── */}
        <Layer
          id="storm-velocity-glow"
          type="line"
          filter={['==', ['get', 'kind'], 'velocity-shaft']}
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
        <Layer
          id="storm-velocity-line"
          type="line"
          filter={['==', ['get', 'kind'], 'velocity-shaft']}
          paint={{
            'line-color': '#f97316',
            'line-width': 3.5,
            'line-opacity': 0.9,
          }}
        />

        {/* ── Trail lines (history → now): glow + dashed core ── */}
        <Layer
          id="storm-trail-line-glow"
          type="line"
          filter={['==', ['get', 'kind'], 'trail-line']}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': 'rgba(168, 85, 247, 0.35)',
            'line-width': 8,
            'line-blur': 4,
            'line-opacity': [
              'interpolate', ['linear'], ['coalesce', ['get', 'newestAgeMin'], 0],
              0,  1.0,
              15, 0.6,
              30, 0.25,
              60, 0.05,
            ],
          }}
        />
        <Layer
          id="storm-trail-line-core"
          type="line"
          filter={['==', ['get', 'kind'], 'trail-line']}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': '#a855f7',
            'line-width': 2.5,
            'line-dasharray': [3, 2],
            'line-opacity': [
              'interpolate', ['linear'], ['coalesce', ['get', 'newestAgeMin'], 0],
              0,  0.85,
              15, 0.55,
              30, 0.2,
              60, 0.05,
            ],
          }}
        />

        {/* ── Projected paths: glow + dashed line ── */}
        <Layer
          id="storm-projected-path-glow"
          type="line"
          filter={['==', ['get', 'kind'], 'projected-path']}
          paint={{
            'line-color': 'rgba(249, 115, 22, 0.15)',
            'line-width': 12,
            'line-blur': 4,
          }}
        />
        <Layer
          id="storm-projected-path-line"
          type="line"
          filter={['==', ['get', 'kind'], 'projected-path']}
          paint={{
            'line-color': 'rgba(249, 115, 22, 0.6)',
            'line-width': 2,
            'line-dasharray': [4, 4],
          }}
        />
      </Source>

      {/* ── POINT SOURCE ───────────────────────────────────────── */}
      <Source id="storm-points" type="geojson" data={stormPoints}>
        {/* ── Trail past positions (fading dots): glow + core ── */}
        <Layer
          id="storm-trail-glow"
          type="circle"
          filter={['==', ['get', 'kind'], 'trail-point']}
          paint={{
            'circle-radius': [
              'interpolate', ['linear'], ['get', 'age'],
              0, 10,
              1, 4,
            ],
            'circle-color': 'rgba(168, 85, 247, 0.15)',
            'circle-blur': 1,
          }}
        />
        <Layer
          id="storm-trail-core"
          type="circle"
          filter={['==', ['get', 'kind'], 'trail-point']}
          paint={{
            'circle-radius': [
              'interpolate', ['linear'], ['get', 'age'],
              0, 4,
              1, 2,
            ],
            'circle-color': [
              'interpolate', ['linear'], ['get', 'age'],
              0, 'rgba(168, 85, 247, 0.6)',
              0.5, 'rgba(168, 85, 247, 0.3)',
              1, 'rgba(100, 116, 139, 0.1)',
            ],
            'circle-stroke-width': 0.5,
            'circle-stroke-color': 'rgba(168, 85, 247, 0.2)',
          }}
        />

        {/* ── Cluster centroids: glow pulse + core marker ── */}
        <Layer
          id="storm-centroid-glow"
          type="circle"
          filter={['==', ['get', 'kind'], 'centroid']}
          paint={{
            'circle-radius': [
              'interpolate', ['linear'], ['get', 'strikeCount'],
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
        <Layer
          id="storm-centroid-core"
          type="circle"
          filter={['==', ['get', 'kind'], 'centroid']}
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

        {/* ── ETA / info labels (on-map text — no drawer needed) ── */}
        <Layer
          id="storm-info-text"
          type="symbol"
          filter={['==', ['get', 'kind'], 'label']}
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
