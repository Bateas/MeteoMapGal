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
import { useState, useEffect, useCallback, useRef, memo } from 'react';
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

/** Distance in km between two lat/lon points (fast equirectangular). */
function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const x = dLon * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.sqrt(x * x + dLat * dLat) * R;
}

/**
 * S122 — Localized fog sampling around detector points (no longer paints full sector).
 * Each detector source contributes a buffer ~6km radius. Density falls with distance.
 * Only paints cells with low elevation (coastal/water-level).
 */
function sampleFogZonesLocal(
  queryElevation: (lngLat: { lng: number; lat: number }) => number | null,
  sources: { lat: number; lon: number }[],
  config: typeof FOG_CONFIG.embalse,
  fogType: 'radiative' | 'advective',
): GeoJSON.FeatureCollection {
  const FOG_RADIUS_KM = 4; // Each source paints up to 4km around itself (webcam visibility range in fog)
  const { maxAltitude, cols, rows } = config;
  const color = fogType === 'advective' ? config.advectiveColor : config.radiativeColor;

  // Compute tight bbox covering all sources + buffer
  const buffer = 0.04; // ~4km in degrees
  const bbox = {
    west: Math.min(...sources.map(s => s.lon)) - buffer,
    east: Math.max(...sources.map(s => s.lon)) + buffer,
    south: Math.min(...sources.map(s => s.lat)) - buffer,
    north: Math.max(...sources.map(s => s.lat)) + buffer,
  };
  const cellW = (bbox.east - bbox.west) / cols;
  const cellH = (bbox.north - bbox.south) / rows;
  const features: GeoJSON.Feature[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const lng = bbox.west + (col + 0.5) * cellW;
      const lat = bbox.south + (row + 0.5) * cellH;

      // S122 fix: maritime fog floats over water AND coastal lowlands.
      // null elevation = water → ALLOW (fog is here!). High altitude = mountain → SKIP.
      const elev = queryElevation({ lng, lat });
      const isWater = elev === null || elev === undefined;
      if (!isWater && elev > maxAltitude) continue;

      // Find closest detector source
      let minDist = Infinity;
      for (const src of sources) {
        const d = distKm(lat, lng, src.lat, src.lon);
        if (d < minDist) minDist = d;
      }
      if (minDist > FOG_RADIUS_KM) continue; // outside any source's range

      // Density: quadratic falloff with distance (sharper edge), blended with altitude
      const linearDist = Math.max(0, 1.0 - minDist / FOG_RADIUS_KM); // 1 at source, 0 at edge
      const distFactor = linearDist * linearDist; // quadratic → sharper falloff, less bleed
      // Water = max altitude factor (1.0). Land = falls with elevation.
      const altFactor = isWater ? 1.0 : (1.0 - elev / maxAltitude);
      const rawDensity = Math.min(1.0, distFactor * 0.8 + altFactor * 0.2);
      if (rawDensity < 0.08) continue; // skip cells too transparent to see
      // S123: discretize density into 4 buckets (0.25/0.5/0.75/1.0). Adjacent cells
      // sharing the same bucket get identical fill-opacity → MapLibre merges them
      // without visible seams (the "tile mosaic" artifact disappears within rings).
      // Trade-off: stepped gradient instead of smooth, but visually much cleaner.
      const density = Math.round(rawDensity * 4) / 4;

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
        properties: { elevation: elev ?? 0, density, color },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

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
      if (elev === null || elev === undefined) continue; // water or unloaded — skip
      const altitude = elev;
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
  // Fade transition: ramps 0→1 on activation (~2s) and 1→0 on dissipation (~5s).
  // Asymmetric timing matches real fog — forms gradually, lifts slowly.
  const [fadeOpacity, setFadeOpacity] = useState(0);
  const lastFogRef = useRef<GeoJSON.FeatureCollection | null>(null);

  // Fix: field is `alerts` not `unifiedAlerts` (bug discovered S116)
  // Only activate overlay on REAL fog (moderate+), not dew point info alerts (S118 false positive fix)
  const alerts = useAlertStore((s) => s.alerts) ?? [];
  const fogAlert: UnifiedAlert | undefined = alerts.find(a =>
    (a.category === 'fog' || a.title?.toLowerCase().includes('niebla'))
    // Only paint overlay on HIGH+ severity — confirmed fog, not just "riesgo"
    // moderate = risk (60% confidence) should NOT paint the entire sector
    // S122: was 'a.level' which doesn't exist — field is 'severity'. Bug existing since type rename
    && (a.severity === 'high' || a.severity === 'critical')
    && !a.title?.toLowerCase().includes('rocío')
  );

  const fogMeta = fogAlert?.fogMeta ?? null;
  const fogType = fogMeta?.type ?? (sectorId === 'rias' ? 'advective' : 'radiative');
  const config = sectorId === 'embalse' ? FOG_CONFIG.embalse : FOG_CONFIG.rias;
  const hasFogAlert = (sectorId === 'embalse' || sectorId === 'rias') && fogAlert != null;

  // Debounce activation: require fog alert for 2s before rendering overlay.
  // Prevents flash on page load from transient partial-data fog detection.
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!hasFogAlert) { setActive(false); return; }
    const timer = setTimeout(() => setActive(true), 2000);
    return () => clearTimeout(timer);
  }, [hasFogAlert]);

  const buildFogZones = useCallback(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const queryElev = (lngLat: { lng: number; lat: number }) => {
      try { return map.queryTerrainElevation?.(lngLat) ?? null; }
      catch { return null; }
    };

    // S122: prefer LOCALIZED sampling when detector sources are available
    const sources = fogMeta?.sources ?? [];
    const data = sources.length > 0
      ? sampleFogZonesLocal(queryElev, sources, config, fogType)
      : sampleFogZones(queryElev, config, fogType, fogMeta?.windDir);

    if (data.features.length >= MIN_CLUSTER_POINTS) {
      setFogGeoJSON(data);
    }
  }, [mapRef, config, sectorId, fogType, fogMeta?.windDir, fogMeta?.sources]);

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

  // Retain last valid fogGeoJSON so fade-out animates on dissipation
  useEffect(() => {
    if (fogGeoJSON) lastFogRef.current = fogGeoJSON;
  }, [fogGeoJSON]);

  // Fade in/out transition (placebo growth/dissipation effect)
  // - appearing: 2s ease-in (fog forms quickly once detected)
  // - dissipating: 5s ease-out (fog lifts slowly, like real marine fog burning off)
  useEffect(() => {
    const shouldShow = active && fogGeoJSON != null;
    const target = shouldShow ? 1 : 0;
    const startT = Date.now();
    const startV = fadeOpacity;
    const delta = target - startV;
    if (Math.abs(delta) < 0.01) return;
    const duration = delta > 0 ? 2000 : 5000;
    let frame: number;
    const tick = () => {
      const elapsed = Date.now() - startT;
      const progress = Math.min(1, elapsed / duration);
      // easeInOutCubic
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      setFadeOpacity(startV + delta * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps — fadeOpacity intentionally read as start value, not tracked
  }, [active, fogGeoJSON != null]);

  // Breathing pulse — subtle "alive" feel
  useEffect(() => {
    if (fadeOpacity === 0) { setOpacity(0); return; }
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
  }, [fadeOpacity === 0]);

  // Keep rendering during fade-out by falling back to last valid features
  const renderGeoJSON = fogGeoJSON ?? (fadeOpacity > 0.01 ? lastFogRef.current : null);
  if (!renderGeoJSON || fadeOpacity < 0.01 || opacity === 0) return null;
  const finalOpacity = opacity * fadeOpacity;

  return (
    <Source id="fog-overlay" type="geojson" data={renderGeoJSON}>
      {/* Fog fill — per-cell density × breathing opacity × fade transition */}
      <Layer
        id="fog-fill"
        type="fill"
        paint={{
          'fill-color': ['get', 'color'],
          'fill-opacity': ['*', ['get', 'density'], finalOpacity],
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
          'line-opacity': finalOpacity * 0.3,
        }}
      />
    </Source>
  );
}

export const FogOverlay = memo(FogOverlayInner);
