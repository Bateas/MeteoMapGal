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

/** Sector-specific fog configuration */
const FOG_CONFIG = {
  embalse: {
    maxAltitude: 185, // valley floor
    bbox: { west: -8.20, east: -7.97, south: 42.24, north: 42.34 },
    cols: 100, rows: 80,
    color: '#cbd5e1',     // gray-white (radiation fog)
    glowColor: '#94a3b8',
  },
  rias: {
    maxAltitude: 35, // sea level + low coastal areas
    bbox: { west: -9.05, east: -8.50, south: 42.10, north: 42.55 },
    cols: 120, rows: 100,
    color: '#94a3b8',     // cooler blue-gray (marine advection fog)
    glowColor: '#64748b',
  },
} as const;

/** Minimum cluster size to form a fog polygon (avoid noise) */
const MIN_CLUSTER_POINTS = 8;

// ── Terrain sampling → GeoJSON ──────────────────────

/**
 * Sample terrain elevation at a grid of points and return a GeoJSON
 * FeatureCollection of small cells where altitude < threshold.
 */
function sampleFogZones(
  queryElevation: (lngLat: { lng: number; lat: number }) => number | null,
  config: typeof FOG_CONFIG.embalse,
): GeoJSON.FeatureCollection {
  const { bbox, cols, rows, maxAltitude } = config;
  const cellW = (bbox.east - bbox.west) / cols;
  const cellH = (bbox.north - bbox.south) / rows;
  const features: GeoJSON.Feature[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const lng = bbox.west + (col + 0.5) * cellW;
      const lat = bbox.south + (row + 0.5) * cellH;

      const elev = queryElevation({ lng, lat });
      // null = no terrain data = water (sea level, 0m) → fog accumulates there
      const altitude = elev ?? 0;
      if (altitude > maxAltitude) continue;

      const x1 = bbox.west + col * cellW;
      const x2 = x1 + cellW;
      const y1 = bbox.south + row * cellH;
      const y2 = y1 + cellH;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]],
        },
        properties: { elevation: altitude },
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

  // Detect fog from unified alert system
  const alerts = useAlertStore((s) => s.unifiedAlerts) ?? [];
  const fogAlert = alerts.find(a =>
    a.category === 'fog' || a.title?.toLowerCase().includes('niebla') || a.title?.toLowerCase().includes('rocío')
  );

  const config = sectorId === 'embalse' ? FOG_CONFIG.embalse : FOG_CONFIG.rias;
  const active = (sectorId === 'embalse' || sectorId === 'rias') && fogAlert != null;

  // Sample terrain when overlay activates — re-runs on sector switch
  const buildFogZones = useCallback(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    console.log(`[FogOverlay] Sampling ${config.cols}x${config.rows} for ${sectorId}...`);

    const data = sampleFogZones((lngLat) => {
      try {
        return map.queryTerrainElevation?.(lngLat) ?? null;
      } catch {
        return null; // no terrain = water = 0m
      }
    }, config);

    console.log(`[FogOverlay] Found ${data.features.length} fog cells`);
    if (data.features.length >= MIN_CLUSTER_POINTS) {
      setFogGeoJSON(data);
    }
  }, [mapRef, config, sectorId]);

  useEffect(() => {
    if (!active) {
      setFogGeoJSON(null);
      return;
    }
    setFogGeoJSON(null); // clear previous sector data

    const map = mapRef?.getMap();
    if (!map) return;

    // Try after delay (terrain needs time to load tiles)
    const timer = setTimeout(buildFogZones, 3000);
    // Also retry when terrain loads
    const onTerrain = () => setTimeout(buildFogZones, 500);
    map.once('terrain', onTerrain);

    return () => {
      clearTimeout(timer);
      map.off('terrain', onTerrain);
    };
  }, [active, sectorId, buildFogZones, mapRef]);

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

  if (!active || !fogGeoJSON || opacity === 0) return null;

  return (
    <Source id="fog-overlay" type="geojson" data={fogGeoJSON}>
      {/* Fog fill — cells in low-lying areas */}
      <Layer
        id="fog-fill"
        type="fill"
        paint={{
          'fill-color': config.color,
          'fill-opacity': opacity,
          'fill-antialias': false,
        }}
      />
      {/* Soft outer glow */}
      <Layer
        id="fog-glow"
        type="line"
        paint={{
          'line-color': config.glowColor,
          'line-width': 12,
          'line-blur': 18,
          'line-opacity': opacity * 0.3,
        }}
      />
    </Source>
  );
}

export const FogOverlay = memo(FogOverlayInner);
