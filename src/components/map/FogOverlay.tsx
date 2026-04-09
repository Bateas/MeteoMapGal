/**
 * FogOverlay — scientific fog visualization using REAL terrain data (#55).
 *
 * Features:
 * - Per-cell density: lower altitude = denser fog (not uniform)
 * - Fog type colors: radiative (warm white) vs advective (blue-steel)
 * - Directional advance: advective fog denser on coast, thins inland
 * - Breathing opacity animation (subtle pulse)
 * - Sectors: Embalse (valley <185m) + Rías Baixas (coastal <35m)
 *
 * Activated by fog alerts in alertStore. Samples terrain DEM on activation.
 */
import { useState, useEffect, useCallback, memo } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import { useSectorStore } from '../../store/sectorStore';
import { useAlertStore } from '../../store/alertStore';
import type { UnifiedAlert } from '../../services/alerts/types';

// ── Config ──────────────────────────────────────────

const FOG_CONFIG = {
  embalse: {
    maxAltitude: 185,
    bbox: { west: -8.20, east: -7.97, south: 42.24, north: 42.34 },
    cols: 100, rows: 80,
    radiativeColor: '#e2e8f0',   // warm white-gray (still, valley)
    advectiveColor: '#94a3b8',   // cooler blue-gray (unlikely in embalse)
    glowColor: '#94a3b8',
  },
  rias: {
    maxAltitude: 35,
    bbox: { west: -9.05, east: -8.50, south: 42.10, north: 42.55 },
    cols: 120, rows: 100,
    radiativeColor: '#cbd5e1',   // lighter gray
    advectiveColor: '#7c9ab8',   // blue-steel (marine character)
    glowColor: '#64748b',
  },
} as const;

const MIN_CLUSTER_POINTS = 8;

// ── Terrain sampling → GeoJSON with density ─────────

function sampleFogZones(
  queryElevation: (lngLat: { lng: number; lat: number }) => number | null,
  config: typeof FOG_CONFIG.embalse,
  fogType: 'radiative' | 'advective',
  windDir?: number | null,
): GeoJSON.FeatureCollection {
  const { bbox, cols, rows, maxAltitude } = config;
  const cellW = (bbox.east - bbox.west) / cols;
  const cellH = (bbox.north - bbox.south) / rows;
  const features: GeoJSON.Feature[] = [];
  const color = fogType === 'advective' ? config.advectiveColor : config.radiativeColor;

  // Precompute directional advance vector for advective fog
  let advanceDx = 0, advanceDy = 0;
  const hasDirection = fogType === 'advective' && windDir != null;
  if (hasDirection) {
    // Wind blows FROM windDir, fog advances in that direction
    const rad = ((windDir! + 180) % 360) * Math.PI / 180;
    advanceDx = Math.sin(rad);
    advanceDy = Math.cos(rad);
  }
  const bboxCenterLng = (bbox.west + bbox.east) / 2;
  const bboxCenterLat = (bbox.south + bbox.north) / 2;
  const halfW = (bbox.east - bbox.west) / 2;
  const halfH = (bbox.north - bbox.south) / 2;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const lng = bbox.west + (col + 0.5) * cellW;
      const lat = bbox.south + (row + 0.5) * cellH;

      const elev = queryElevation({ lng, lat });
      const altitude = elev ?? 0;
      if (altitude > maxAltitude) continue;

      // Per-cell density based on altitude (lower = denser)
      let altFactor = 1.0 - (altitude / maxAltitude);

      // Directional advance for advective fog
      let density: number;
      if (hasDirection) {
        const cx = (lng - bboxCenterLng) / halfW;
        const cy = (lat - bboxCenterLat) / halfH;
        const advancePos = cx * advanceDx + cy * advanceDy;
        // Leading edge (negative = toward fog source) = denser
        const dirFactor = Math.max(0, 1.0 - (advancePos + 1) / 2);
        density = altFactor * 0.6 + dirFactor * 0.4;
      } else {
        // Radiative: pure altitude-based (valley floor = dense)
        density = altFactor;
      }

      // Clamp to visible range
      density = Math.max(0.2, Math.min(1.0, density));

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
        properties: { elevation: altitude, density, color },
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

  // Fix: field is `alerts` not `unifiedAlerts` (bug discovered S116)
  const alerts = useAlertStore((s) => s.alerts) ?? [];
  const fogAlert: UnifiedAlert | undefined = alerts.find(a =>
    a.category === 'fog' || a.title?.toLowerCase().includes('niebla') || a.title?.toLowerCase().includes('rocío')
  );

  const fogMeta = fogAlert?.fogMeta ?? null;
  const fogType = fogMeta?.type ?? (sectorId === 'rias' ? 'advective' : 'radiative');
  const config = sectorId === 'embalse' ? FOG_CONFIG.embalse : FOG_CONFIG.rias;
  const active = (sectorId === 'embalse' || sectorId === 'rias') && fogAlert != null;

  const buildFogZones = useCallback(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const data = sampleFogZones(
      (lngLat) => {
        try { return map.queryTerrainElevation?.(lngLat) ?? null; }
        catch { return null; }
      },
      config,
      fogType,
      fogMeta?.windDir,
    );
    if (data.features.length >= MIN_CLUSTER_POINTS) {
      setFogGeoJSON(data);
    }
  }, [mapRef, config, sectorId, fogType, fogMeta?.windDir]);

  useEffect(() => {
    if (!active) {
      setFogGeoJSON(null);
      return;
    }
    setFogGeoJSON(null);

    const map = mapRef?.getMap();
    if (!map) return;

    const timer = setTimeout(buildFogZones, 3000);
    const onTerrain = () => setTimeout(buildFogZones, 500);
    map.once('terrain', onTerrain);

    return () => {
      clearTimeout(timer);
      map.off('terrain', onTerrain);
    };
  }, [active, sectorId, buildFogZones, mapRef]);

  // Breathing animation — subtle pulse with per-cell density modulation
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
      {/* Fog fill — per-cell density × breathing opacity */}
      <Layer
        id="fog-fill"
        type="fill"
        paint={{
          'fill-color': ['get', 'color'],
          'fill-opacity': ['*', ['get', 'density'], opacity],
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
