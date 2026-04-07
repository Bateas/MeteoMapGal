import { useMemo, memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useLightningStore } from '../../hooks/useLightningData';
import { useSectorStore } from '../../store/sectorStore';
import type { StormCluster, ClusterSnapshot } from '../../services/stormTracker';

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

  const endLat = cluster.centroidLat + (arrowLenKm / 111.32) * Math.cos(bearingRad);
  const endLon =
    cluster.centroidLon +
    (arrowLenKm / (111.32 * Math.cos((cluster.centroidLat * Math.PI) / 180))) *
      Math.sin(bearingRad);

  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [cluster.centroidLon, cluster.centroidLat],
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
  const tipLat = cluster.centroidLat + (arrowLenKm / 111.32) * Math.cos(bearingRad);
  const tipLon =
    cluster.centroidLon +
    (arrowLenKm / (111.32 * Math.cos((cluster.centroidLat * Math.PI) / 180))) *
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
  if (!cluster.velocity || !cluster.approaching) return null;

  const { bearingDeg, speedKmh } = cluster.velocity;
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const coords: [number, number][] = [[cluster.centroidLon, cluster.centroidLat]];

  for (let min = 5; min <= 15; min += 5) {
    const distKm = (speedKmh / 60) * min;
    const lat = cluster.centroidLat + (distKm / 111.32) * Math.cos(bearingRad);
    const lon = cluster.centroidLon + (distKm / (111.32 * Math.cos((cluster.centroidLat * Math.PI) / 180))) * Math.sin(bearingRad);
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
function etaLabelPoint(cluster: StormCluster): GeoJSON.Feature<GeoJSON.Point> | null {
  if (!cluster.approaching || cluster.etaMinutes === null) return null;

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [cluster.centroidLon, cluster.centroidLat] },
    properties: {
      label: `${cluster.etaMinutes}min`,
      distance: `${cluster.distanceToReservoir.toFixed(0)}km`,
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

  // ── Cluster mass areas (big gradient circles) ────────────────
  const clusterMasses = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || clusters.length === 0) return EMPTY_FC;

    const features: GeoJSON.Feature[] = [];

    for (const cluster of clusters) {
      // Outer haze: cluster radius + extra padding for visual drama
      const hazeRadius = Math.max(cluster.radiusKm + 8, 12);
      const haze = circlePolygon(cluster.centroidLon, cluster.centroidLat, hazeRadius);
      haze.properties = {
        type: 'haze',
        approaching: cluster.approaching ? 1 : 0,
        intensity: Math.min(cluster.strikeCount / 10, 1), // 0-1 based on activity
        distance: cluster.distanceToReservoir,
      };
      features.push(haze);

      // Inner core: cluster radius
      const coreRadius = Math.max(cluster.radiusKm, 4);
      const core = circlePolygon(cluster.centroidLon, cluster.centroidLat, coreRadius);
      core.properties = {
        type: 'core',
        approaching: cluster.approaching ? 1 : 0,
        intensity: Math.min(cluster.strikeCount / 10, 1),
        distance: cluster.distanceToReservoir,
        newestAgeMin: cluster.newestAgeMin,
      };
      features.push(core);
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

  // ── ETA labels (approaching clusters) ───────────────────
  const etaLabels = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || clusters.length === 0) return EMPTY_FC;
    const features: GeoJSON.Feature[] = [];
    for (const c of clusters) {
      const label = etaLabelPoint(c);
      if (label) features.push(label);
    }
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
            'line-color': [
              'case',
              ['==', ['get', 'approaching'], 1],
              '#ef4444',
              '#a78bfa',
            ],
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
            'fill-color': [
              'case',
              ['==', ['get', 'approaching'], 1],
              'rgba(239, 68, 68, 0.9)',
              'rgba(167, 139, 250, 0.7)',
            ],
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
            'line-color': 'rgba(239, 68, 68, 0.15)',
            'line-width': 12,
            'line-blur': 4,
          }}
        />
        <Layer
          id="storm-projected-path-line"
          type="line"
          paint={{
            'line-color': 'rgba(239, 68, 68, 0.6)',
            'line-width': 2,
            'line-dasharray': [4, 4],
          }}
        />
      </Source>

      {/* ── ETA countdown labels ───────────────────────────── */}
      <Source id="storm-eta-labels" type="geojson" data={etaLabels}>
        <Layer
          id="storm-eta-text"
          type="symbol"
          layout={{
            'text-field': ['concat', '⚡ ', ['get', 'label']],
            'text-font': ['Noto Sans Bold'],
            'text-size': 13,
            'text-offset': [0, -2.5],
            'text-allow-overlap': true,
          }}
          paint={{
            'text-color': '#fbbf24',
            'text-halo-color': 'rgba(0, 0, 0, 0.85)',
            'text-halo-width': 2,
          }}
        />
        <Layer
          id="storm-distance-text"
          type="symbol"
          layout={{
            'text-field': ['get', 'distance'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 10,
            'text-offset': [0, -1.2],
            'text-allow-overlap': true,
          }}
          paint={{
            'text-color': '#94a3b8',
            'text-halo-color': 'rgba(0, 0, 0, 0.8)',
            'text-halo-width': 1.5,
          }}
        />
      </Source>
    </>
  );
});
