import { useMemo, memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useLightningStore } from '../../hooks/useLightningData';
import { bearingToCardinal, type StormCluster } from '../../services/stormTracker';
import { useMapInk } from '../../hooks/useMapInk';

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
// DISSIPATING_AGE_MIN. At that point the movement stops being trustworthy, so
// the arrow goes and the mass dims (paint expressions below).
const DISSIPATING_AGE_MIN = 15;

/** True when the cluster has had recent enough activity to justify drawing where it is going. */
function isClusterActive(c: StormCluster): boolean {
  return c.newestAgeMin <= DISSIPATING_AGE_MIN;
}

/** The arrow only renders when there's actual movement to show. */
function isClusterMoving(c: StormCluster): boolean {
  // A 'low' vector is the centroid jumping as cells are born beside each other (6-oct: arrows of
  // 30-68 km/h under a 6-8 km/h steering wind). The tracker keeps it for severity only.
  return c.velocity != null && c.velocity.confidence !== 'low';
}

/**
 * Generate a circle polygon (GeoJSON) centered at [lon, lat] with given radius in km.
 * Default segments=32 (was 64 before — half vertices for same visual smoothness
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

/** Build rich info label for EVERY cluster (on-map, no drawer needed) */
function clusterInfoPoint(cluster: StormCluster): GeoJSON.Feature<GeoJSON.Point> {
  const lines: string[] = [];

  lines.push(`${cluster.strikeCount} rayos`);

  // Line: speed + direction (only a vector the tracker trusts)
  if (cluster.velocity && isClusterMoving(cluster)) {
    const dir = bearingToCardinal(cluster.velocity.bearingDeg);
    lines.push(`→ ${cluster.velocity.speedKmh.toFixed(0)} km/h ${dir}`);
  }

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [cluster.lon, cluster.lat] },
    properties: {
      label: lines.join('\n'),
      approaching: cluster.approaching ? 1 : 0,
      hasVelocity: isClusterMoving(cluster) ? 1 : 0,
      distance: cluster.distanceToReservoir,
      speedKmh: isClusterMoving(cluster) ? cluster.velocity?.speedKmh ?? 0 : 0,
    },
  };
}

/**
 * Storm cluster visualization overlay.
 *
 * Renders on the map the mass of each cluster, the arrow of where it goes, and a label with its strikes and
 * movement. No rings at the centre of the sector, which marked no phenomenon and read as the storm itself; no
 * ghost, path or trail, three more drawings of the same vector; no hail rings, which came from model CAPE at
 * one point; no arrival time, which failed 59 of 69 on 6-oct. How close it is to a spot is the band's job.
 * Each feature carries a `kind` property used by layer filters.
 */
export const StormClusterOverlay = memo(function StormClusterOverlay() {
  const clusters = useLightningStore((s) => s.clusters);
  // strikes now carried as cluster.strikePositions (no separate store read needed)
  const showOverlay = useLightningStore((s) => s.showOverlay);
  const ink = useMapInk();

  // ── POLYGON SOURCE ───────────────────────────────────────────────
  const stormPolygons = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay) return EMPTY_FC;

    const features: GeoJSON.Feature[] = [];

    // ── Cluster masses (haze + core via convex hull) ──
    for (const cluster of clusters) {
      const hull = getCachedHull(cluster);

      if (hull) {
        const hazeShape = hullToShape(cluster, hull, 4);
        hazeShape.properties = {
          ...hazeShape.properties,
          kind: 'mass-haze',
          newestAgeMin: cluster.newestAgeMin,
        };
        features.push(hazeShape);

        const coreShape = hullToShape(cluster, hull, 1.5);
        coreShape.properties = {
          ...coreShape.properties,
          kind: 'mass-core',
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
        };
        features.push(core);
      }
    }

    // ── Velocity tips (arrow heads — small triangle polygons) ──
    for (const c of clusters) {
      if (!isClusterActive(c) || !isClusterMoving(c)) continue;
      const tip = arrowTip(c);
      if (tip) {
        tip.properties = {
          ...tip.properties,
          kind: 'velocity-tip',
          confidence: c.velocity?.confidence ?? 'medium',
        };
        features.push(tip);
      }
    }

    return { type: 'FeatureCollection', features };
  }, [showOverlay, clusters]);

  // ── LINE SOURCE ─────────────────────────────────────────────────
  const stormLines = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay) return EMPTY_FC;

    const features: GeoJSON.Feature[] = [];

    // ── Velocity arrow shafts ──
    for (const c of clusters) {
      if (!isClusterActive(c) || !isClusterMoving(c)) continue;
      const arrow = velocityArrow(c);
      if (arrow) {
        arrow.properties = {
          ...arrow.properties,
          kind: 'velocity-shaft',
          confidence: c.velocity?.confidence ?? 'medium',
        };
        features.push(arrow);
      }
    }

    return { type: 'FeatureCollection', features };
  }, [showOverlay, clusters]);

  // ── POINT SOURCE ────────────────────────────────────────────────
  const stormPoints = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay) return EMPTY_FC;

    const features: GeoJSON.Feature[] = [];

    // ── Labels (one per cluster) ──
    for (const c of clusters) {
      const info = clusterInfoPoint(c);
      info.properties = { ...info.properties, kind: 'label' };
      features.push(info);
    }

    return { type: 'FeatureCollection', features };
  }, [showOverlay, clusters]);

  if (!showOverlay) return null;

  return (
    <>
      {/* ── POLYGON SOURCE ─────────────────────────────────────── */}
      <Source id="storm-polygons" type="geojson" data={stormPolygons}>
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
              'case',
              ['==', ['get', 'approaching'], 1],
              'rgba(220, 38, 38, 0.20)',
              'rgba(139, 92, 246, 0.15)',
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

        {/* ── Velocity arrow tips (triangle fill) ── */}
        <Layer
          id="storm-velocity-tip"
          type="fill"
          filter={['==', ['get', 'kind'], 'velocity-tip']}
          paint={{
            // confidence-modulated opacity: low fits get a dimmer tip so the
            // arrowhead reads as "soft pointer" rather than "definitive vector".
            'fill-color': [
              'match', ['coalesce', ['get', 'confidence'], 'medium'],
              'high', 'rgba(249, 115, 22, 0.95)',
              'medium', 'rgba(249, 115, 22, 0.85)',
              'low', 'rgba(249, 115, 22, 0.45)',
              'rgba(249, 115, 22, 0.85)',
            ],
          }}
        />
      </Source>

      {/* ── LINE SOURCE ────────────────────────────────────────── */}
      <Source id="storm-lines" type="geojson" data={stormLines}>
        {/* ── Velocity arrow shafts: glow + solid core ──
            Confidence modulates width + opacity. Low-confidence shaft is
            thinner and tenue so it suggests "tentative" not "certain". */}
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
            'line-width': [
              'match', ['coalesce', ['get', 'confidence'], 'medium'],
              'high', 10,
              'medium', 8,
              'low', 5,
              8,
            ],
            'line-blur': 3,
            'line-opacity': [
              'match', ['coalesce', ['get', 'confidence'], 'medium'],
              'high', 1.0,
              'medium', 0.85,
              'low', 0.45,
              0.85,
            ],
          }}
        />
        <Layer
          id="storm-velocity-line"
          type="line"
          filter={['==', ['get', 'kind'], 'velocity-shaft']}
          paint={{
            'line-color': '#f97316',
            'line-width': [
              'match', ['coalesce', ['get', 'confidence'], 'medium'],
              'high', 4,
              'medium', 3.5,
              'low', 2.5,
              3.5,
            ],
            'line-opacity': [
              'match', ['coalesce', ['get', 'confidence'], 'medium'],
              'high', 1.0,
              'medium', 0.9,
              'low', 0.5,
              0.9,
            ],
          }}
        />


      </Source>

      {/* ── POINT SOURCE ───────────────────────────────────────── */}
      <Source id="storm-points" type="geojson" data={stormPoints}>


        {/* ── Labels (on-map text — no drawer needed) ── */}
        <Layer
          id="storm-info-text"
          type="symbol"
          filter={['==', ['get', 'kind'], 'label']}
          layout={{
            'text-field': ['get', 'label'],
            'text-font': ['Noto Sans Bold'],
            'text-size': 12,
            'text-offset': [0, -2.5],
            // Collision-hide overlapping labels: during a big multi-cluster storm
            // (16+ cells) allow-overlap=true stacked every label into an unreadable
            // mush. false lets MapLibre drop colliding ones; the CLOSEST storm wins
            // the collision via symbol-sort-key (lower distance renders first), since
            // the nearby cell is the one that matters for "do I take shelter".
            'text-allow-overlap': false,
            'text-padding': 6,
            'symbol-sort-key': ['get', 'distance'],
            'text-anchor': 'bottom',
            'text-line-height': 1.3,
          }}
          paint={{
            'text-color': ink.text,
            'text-halo-color': ink.halo,
            'text-halo-width': 2,
          }}
        />
      </Source>
    </>
  );
});
