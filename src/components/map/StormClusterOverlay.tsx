import { useMemo, memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useLightningStore } from '../../hooks/useLightningData';
import { useSectorStore } from '../../store/sectorStore';
import { bearingToCardinal, type StormCluster, type ClusterSnapshot } from '../../services/stormTracker';

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

/** Expand a polygon outward by bufferKm (approximate, works for small regions) */
function bufferPolygon(coords: [number, number][], bufferKm: number, centerLat: number): [number, number][] {
  // Find centroid
  const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const bufferDeg = bufferKm / 111.32;
  const bufferDegLon = bufferKm / (111.32 * Math.cos((centerLat * Math.PI) / 180));
  return coords.map(([lon, lat]) => {
    const dx = lon - cx;
    const dy = lat - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.0001) return [lon + bufferDegLon, lat]; // avoid division by zero
    const scale = (dist + (dx > 0 ? bufferDegLon : -bufferDegLon > 0 ? bufferDegLon : bufferDeg)) / dist;
    return [cx + dx * (1 + bufferKm / (dist * 111.32)), cy + dy * (1 + bufferKm / (dist * 111.32))] as [number, number];
  });
}

/** Build cluster shape from actual strike positions (convex hull) */
function clusterShape(
  cluster: StormCluster,
  bufferKm: number,
): GeoJSON.Feature<GeoJSON.Polygon> | null {
  // Use pre-computed strike positions from cluster (no re-scanning needed)
  const points = cluster.strikePositions;
  if (points.length < 3) return null; // need 3+ points for hull

  const hull = convexHull(points);
  if (hull.length < 3) return null;

  // Expand hull outward for visual buffer
  const expanded = hull.map(([lon, lat]) => {
    const dx = lon - cluster.lon;
    const dy = lat - cluster.lat;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.00001) return [lon, lat] as [number, number];
    const bufDeg = bufferKm / 111.32;
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
function velocityArrow(cluster: StormCluster): GeoJSON.Feature<GeoJSON.LineString> | null {
  if (!cluster.velocity) return null;

  const { bearingDeg, speedKmh } = cluster.velocity;
  // Arrow length: 1km per 4 km/h of speed, min 3km, capped at 18km
  const arrowLenKm = Math.max(3, Math.min(speedKmh / 4, 18));
  const bearingRad = (bearingDeg * Math.PI) / 180;

  const endLat = cluster.lat + (arrowLenKm / 111.32) * Math.cos(bearingRad);
  const endLon =
    cluster.lon +
    (arrowLenKm / (111.32 * Math.cos((cluster.lat * Math.PI) / 180))) *
      Math.sin(bearingRad);

  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [cluster.lon, cluster.lat],
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
  const arrowLenKm = Math.max(3, Math.min(speedKmh / 4, 18));
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const tipSizeKm = 2.5; // bigger arrowhead for visibility

  // Tip point
  const tipLat = cluster.lat + (arrowLenKm / 111.32) * Math.cos(bearingRad);
  const tipLon =
    cluster.lon +
    (arrowLenKm / (111.32 * Math.cos((cluster.lat * Math.PI) / 180))) *
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
  const coords: [number, number][] = [[cluster.lon, cluster.lat]];

  for (const min of [5, 10, 15, 20, 30]) {
    const distKm = (speedKmh / 60) * min;
    const lat = cluster.lat + (distKm / 111.32) * Math.cos(bearingRad);
    const lon = cluster.lon + (distKm / (111.32 * Math.cos((cluster.lat * Math.PI) / 180))) * Math.sin(bearingRad);
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

  // Line 1: strike count
  lines.push(`${cluster.strikeCount} rayos`);

  // Line 2: speed + direction (if velocity known)
  if (cluster.velocity) {
    const dir = bearingToCardinal(cluster.velocity.bearingDeg);
    lines.push(`→ ${cluster.velocity.speedKmh.toFixed(0)} km/h ${dir}`);
  }

  // Line 3: ETA (if approaching)
  if (cluster.approaching && cluster.etaMinutes != null) {
    lines.push(`ETA ~${cluster.etaMinutes} min`);
  }

  // Line 4: distance
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
      const watch = circlePolygon(centerLon, centerLat, 50);
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
      // Try convex hull from actual strike positions (organic shape)
      const hullShape = clusterShape(cluster, 8); // 8km buffer for haze
      if (hullShape) {
        hullShape.properties = {
          ...hullShape.properties,
          type: 'haze',
        };
        features.push(hullShape);
      }

      // Inner core — tighter hull (3km buffer)
      const coreShape = clusterShape(cluster, 3);
      if (coreShape) {
        coreShape.properties = {
          ...coreShape.properties,
          type: 'core',
          newestAgeMin: cluster.newestAgeMin,
        };
        features.push(coreShape);
      } else {
        // Fallback to circle if not enough strikes for hull
        const coreRadius = Math.min(Math.max(cluster.radiusKm, 4), 25);
        const core = circlePolygon(cluster.lon, cluster.lat, coreRadius);
        core.properties = {
          type: 'core',
          approaching: cluster.approaching ? 1 : 0,
          intensity: Math.min(cluster.strikeCount / 10, 1),
          distance: cluster.distanceToReservoir,
          newestAgeMin: cluster.newestAgeMin,
        };
        features.push(core);
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
  const trailPoints = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || clusterHistory.length <= 1) return EMPTY_FC;

    const now = Date.now();
    const features: GeoJSON.Feature[] = [];

    // Skip the most recent snapshot (that's the current position)
    const pastSnapshots = clusterHistory.slice(0, -1);

    for (const snapshot of pastSnapshots) {
      const ageMs = now - snapshot.timestamp;
      const ageMinutes = ageMs / 60_000;
      // Normalize age: 0 = recent, 1 = old (15 min max)
      const ageFactor = Math.min(ageMinutes / 15, 1);

      for (const centroid of snapshot.centroids) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [centroid.lon, centroid.lat],
          },
          properties: {
            age: ageFactor,
            strikeCount: centroid.strikeCount,
          },
        });
      }
    }

    return { type: 'FeatureCollection', features };
  }, [showOverlay, clusterHistory]);

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
              'rgba(220, 38, 38, 0.14)',  // red-ish for approaching
              'rgba(139, 92, 246, 0.10)', // purple for others
            ],
            'fill-antialias': true,
          }}
        />
        {/* Inner core — more opaque, danger feel */}
        <Layer
          id="storm-mass-core"
          type="fill"
          filter={['==', ['get', 'type'], 'core']}
          paint={{
            'fill-color': [
              'interpolate',
              ['linear'],
              ['get', 'newestAgeMin'],
              0, 'rgba(239, 68, 68, 0.30)',   // very fresh → strong red
              15, 'rgba(249, 115, 22, 0.20)',  // 15min → orange
              30, 'rgba(168, 85, 247, 0.12)',  // 30min → fading purple
              60, 'rgba(100, 116, 139, 0.06)', // 60min → gray
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
              'rgba(239, 68, 68, 0.50)',
              'rgba(168, 85, 247, 0.35)',
            ],
            'line-width': 2,
            'line-dasharray': [3, 2],
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

      {/* ── Storm trail history (fading ghost positions) ───────── */}
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
