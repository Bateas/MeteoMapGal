/**
 * FogOverlay — visual fog effect on low-lying areas using REAL terrain data.
 *
 * Samples terrain elevation from MapLibre DEM tiles and generates a polygon
 * covering only areas below a threshold altitude (~180m). The fog "fills"
 * the valley automatically based on actual topography.
 *
 * Semi-transparent white fill with subtle "breathing" opacity animation.
 * Only renders in Embalse sector when fog conditions are detected.
 */
import { useState, useEffect, useCallback, memo } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import { useSectorStore } from '../../store/sectorStore';
import { useAlertStore } from '../../store/alertStore';

// ── Config ──────────────────────────────────────────

/** Max altitude for fog (meters). Areas above this won't get fog overlay. */
const FOG_MAX_ALTITUDE = 185;

/** Bounding box to sample terrain (covers Miño valley + Avia tributary) */
const SAMPLE_BBOX = {
  west: -8.20,
  east: -7.97,
  south: 42.24,
  north: 42.34,
};

/** Grid resolution for terrain sampling (higher = smoother edges, sampled once) */
const GRID_COLS = 100;
const GRID_ROWS = 80;

/** Minimum cluster size to form a fog polygon (avoid noise) */
const MIN_CLUSTER_POINTS = 8;

// ── Terrain sampling → GeoJSON ──────────────────────

/**
 * Sample terrain elevation at a grid of points and return a GeoJSON
 * FeatureCollection of small cells where altitude < threshold.
 */
function sampleFogZones(
  queryElevation: (lngLat: { lng: number; lat: number }) => number | null,
): GeoJSON.FeatureCollection {
  const cellW = (SAMPLE_BBOX.east - SAMPLE_BBOX.west) / GRID_COLS;
  const cellH = (SAMPLE_BBOX.north - SAMPLE_BBOX.south) / GRID_ROWS;
  const features: GeoJSON.Feature[] = [];

  // Sample grid and collect low-elevation cells
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const lng = SAMPLE_BBOX.west + (col + 0.5) * cellW;
      const lat = SAMPLE_BBOX.south + (row + 0.5) * cellH;

      const elev = queryElevation({ lng, lat });
      if (elev === null || elev > FOG_MAX_ALTITUDE) continue;

      // Exact cell bounds (no overlap — at 100x80 resolution seams are invisible)
      const x1 = SAMPLE_BBOX.west + col * cellW;
      const x2 = x1 + cellW;
      const y1 = SAMPLE_BBOX.south + row * cellH;
      const y2 = y1 + cellH;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]],
        },
        properties: { elevation: elev },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

// ── Component ───────────────────────────────────────

function FogOverlayInner() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const { current: mapRef } = useMap();
  const [opacity, setOpacity] = useState(0);
  const [fogGeoJSON, setFogGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);

  // Detect fog from unified alert system (category='fog' or 'niebla')
  const alerts = useAlertStore((s) => s.unifiedAlerts);
  const fogAlert = alerts.find(a =>
    a.category === 'fog' || a.title?.toLowerCase().includes('niebla') || a.title?.toLowerCase().includes('rocío')
  );
  const active = sectorId === 'embalse' && fogAlert != null;

  // Sample terrain when overlay activates (only once — terrain doesn't change)
  const buildFogZones = useCallback(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    // Need terrain to be loaded
    if (!map.getTerrain()) {
      // Retry after terrain loads
      map.once('terrain', () => buildFogZones());
      return;
    }

    const data = sampleFogZones((lngLat) => {
      try {
        return map.queryTerrainElevation(lngLat) ?? null;
      } catch {
        return null;
      }
    });

    if (data.features.length >= MIN_CLUSTER_POINTS) {
      setFogGeoJSON(data);
    }
  }, [mapRef]);

  useEffect(() => {
    if (!active || sectorId !== 'embalse') return;
    // Wait a bit for terrain tiles to load
    const timer = setTimeout(buildFogZones, 2000);
    return () => clearTimeout(timer);
  }, [active, sectorId, buildFogZones]);

  // Breathing animation — subtle pulse
  useEffect(() => {
    if (!active || !fogGeoJSON) {
      setOpacity(0);
      return;
    }
    let frame: number;
    const start = Date.now();
    function animate() {
      const t = (Date.now() - start) / 1000;
      const o = 0.12 + 0.04 * Math.sin(t * 0.6);
      setOpacity(o);
      frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [active, fogGeoJSON]);

  if (sectorId !== 'embalse' || !active || !fogGeoJSON || opacity === 0) return null;

  return (
    <Source id="fog-overlay" type="geojson" data={fogGeoJSON}>
      {/* Fog fill — white cells in low-lying areas */}
      <Layer
        id="fog-fill"
        type="fill"
        paint={{
          'fill-color': '#cbd5e1',
          'fill-opacity': opacity,
          'fill-antialias': false, // smoother merge between cells
        }}
      />
      {/* Soft outer glow — blurred edges for organic look */}
      <Layer
        id="fog-glow"
        type="line"
        paint={{
          'line-color': '#94a3b8',
          'line-width': 12,
          'line-blur': 18,
          'line-opacity': opacity * 0.3,
        }}
      />
    </Source>
  );
}

export const FogOverlay = memo(FogOverlayInner);
