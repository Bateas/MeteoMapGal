/**
 * FogOverlay — scientific fog visualization using REAL terrain data (#55).
 *
 * Features:
 * - Per-cell density: lower altitude = denser fog (not uniform)
 * - Fog type colors: radiative (warm white) vs advective (blue-steel)
 * - Directional advance: advective fog denser on coast, thins inland
 * - Fade in/out transition on activation/dissipation (no perpetual animation)
 * - Sectors: Embalse (valley <185m) + Rías Baixas (coastal <35m)
 *
 * Activated by fog alerts in alertStore. Samples terrain DEM on activation.
 */
import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import { useSectorStore } from '../../store/sectorStore';
import { isCoastalSector } from '../../config/sectors';
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
 * Localized fog sampling around detector points (no longer paints full sector).
 * Each detector source contributes a buffer ~6km radius. Density falls with distance.
 * Only paints cells with low elevation (coastal/water-level).
 */
// Yield to the event loop every CHUNK_CELLS iterations so the main thread
// stays responsive. Without this, processing ~1800 cells back-to-back blocks
// the browser for 400-700ms (visible jank + `setTimeout handler took 621ms`
// violations on mobile when fog appears). 100 cells × ~0.3ms = ~30ms per
// chunk, comfortably under the 50ms long-task threshold.
const CHUNK_CELLS = 100;
const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0));

async function sampleFogZonesLocal(
  queryElevation: (lngLat: { lng: number; lat: number }) => number | null,
  sources: { lat: number; lon: number }[],
  config: typeof FOG_CONFIG.embalse | typeof FOG_CONFIG.rias,
  fogType: 'radiative' | 'advective',
  signal?: AbortSignal,
): Promise<GeoJSON.FeatureCollection> {
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
  let cellsProcessed = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Yield to event loop every CHUNK_CELLS cells (~30ms of work) so the
      // main thread can render and respond to input. Also check for abort.
      if (++cellsProcessed % CHUNK_CELLS === 0) {
        await yieldToEventLoop();
        if (signal?.aborted) throw new DOMException('Fog build aborted', 'AbortError');
      }
      const lng = bbox.west + (col + 0.5) * cellW;
      const lat = bbox.south + (row + 0.5) * cellH;

      // perf: distance filter FIRST (cheap math), then elevation lookup
      // (expensive DEM read). Previously elev was sampled for every cell of the
      // sector grid (8000-12000 cells) but only ~10% pass the 4km radius — we
      // were paying 90% of DEM cost for nothing. Saves ~600ms during fog build.
      let minDist = Infinity;
      for (const src of sources) {
        const d = distKm(lat, lng, src.lat, src.lon);
        if (d < minDist) minDist = d;
      }
      if (minDist > FOG_RADIUS_KM) continue; // outside any source's range

      // fix: maritime fog floats over water AND coastal lowlands.
      // null elevation = water → ALLOW (fog is here!). High altitude = mountain → SKIP.
      const elev = queryElevation({ lng, lat });
      const isWater = elev === null || elev === undefined;
      if (!isWater && elev > maxAltitude) continue;

      // Density: quadratic falloff with distance (sharper edge), blended with altitude
      const linearDist = Math.max(0, 1.0 - minDist / FOG_RADIUS_KM); // 1 at source, 0 at edge
      const distFactor = linearDist * linearDist; // quadratic → sharper falloff, less bleed
      // Water = max altitude factor (1.0). Land = falls with elevation.
      const altFactor = isWater ? 1.0 : (1.0 - elev / maxAltitude);
      const rawDensity = Math.min(1.0, distFactor * 0.8 + altFactor * 0.2);
      if (rawDensity < 0.08) continue; // skip cells too transparent to see
      // Discretize density into 8 buckets (0.125, 0.25, ..., 1.0). Adjacent
      // cells sharing the same bucket get identical fill-opacity → MapLibre
      // merges them without visible seams. 8 buckets give a finer gradient
      // than 4 (which user reported as "mini-cuadrados en Ons" — the steps
      // between buckets were too coarse and individual cells stood out).
      const density = Math.round(rawDensity * 8) / 8;

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

// ── Component ───────────────────────────────────────

function FogOverlayInner() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const { current: mapRef } = useMap();
  // Steady-state fog opacity (constant). The old "breathing pulse" was a
  // perpetual ~20fps rAF + setState that re-rendered this component FOREVER
  // while fog was active — the dominant idle CPU churn in the v2.86.0 pan/perf
  // trace (it ran the same panning or sitting still, hence the fan spinning on
  // a static map). The pulse is visually indistinguishable from a constant, so
  // it's removed; only the brief fade in/out animates now (and that self-stops).
  const FOG_BASE_OPACITY = 0.12;
  const [fogGeoJSON, setFogGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  // Fade transition: ramps 0→1 on activation (~2s) and 1→0 on dissipation (~5s).
  // Asymmetric timing matches real fog — forms gradually, lifts slowly.
  const [fadeOpacity, setFadeOpacity] = useState(0);
  const lastFogRef = useRef<GeoJSON.FeatureCollection | null>(null);

  // Fix: field is `alerts` not `unifiedAlerts` (bug discovered)
  // Only activate overlay on REAL fog (moderate+), not dew point info alerts
  const alerts = useAlertStore((s) => s.alerts) ?? [];
  const fogAlert: UnifiedAlert | undefined = alerts.find(a =>
    (a.category === 'fog' || a.title?.toLowerCase().includes('niebla'))
    // Only paint overlay on HIGH+ severity — confirmed fog, not just "riesgo"
    // moderate = risk (60% confidence) should NOT paint the entire sector
    // was 'a.level' which doesn't exist — field is 'severity'. Bug existing since type rename
    && (a.severity === 'high' || a.severity === 'critical')
    && !a.title?.toLowerCase().includes('rocío')
  );

  const fogMeta = fogAlert?.fogMeta ?? null;
  const coastal = isCoastalSector(sectorId);
  const fogType = fogMeta?.type ?? (coastal ? 'advective' : 'radiative');
  const config = coastal ? FOG_CONFIG.rias : FOG_CONFIG.embalse;
  const hasFogAlert = fogAlert != null;

  // Debounce activation: require fog alert for 2s before rendering overlay.
  // Prevents flash on page load from transient partial-data fog detection.
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!hasFogAlert) { setActive(false); return; }
    const timer = setTimeout(() => setActive(true), 2000);
    return () => clearTimeout(timer);
  }, [hasFogAlert]);

  // perf: prevent re-entrancy. The build effect can fire 2-4× during
  // initial load (timer 3s + 'terrain' event + store rehydration). Each fire
  // is ~150ms, still cumulative if all run back-to-back.
  // Skip rebuilds < 2s apart — geometry doesn't change that fast anyway.
  const lastBuildAtRef = useRef<number>(0);
  const MIN_BUILD_GAP_MS = 2000;
  // Cancel any in-flight async build when a new one starts (sector change,
  // wind dir update, sources update, unmount). Avoids stale GeoJSON landing
  // after a newer build was requested.
  const buildAbortRef = useRef<AbortController | null>(null);

  const buildFogZones = useCallback(async () => {
    const map = mapRef?.getMap();
    if (!map) return;

    const now = Date.now();
    if (now - lastBuildAtRef.current < MIN_BUILD_GAP_MS) return;
    lastBuildAtRef.current = now;

    // Cancel previous build and start a new one
    buildAbortRef.current?.abort();
    const ac = new AbortController();
    buildAbortRef.current = ac;

    const queryElev = (lngLat: { lng: number; lat: number }) => {
      try { return map.queryTerrainElevation?.(lngLat) ?? null; }
      catch { return null; }
    };

    try {
      // LOCALIZED sampling ONLY: paint ~4km blobs around real detector sources.
      // If there are no localized sources we do NOT blanket the whole sector —
      // that painted fog "donde no era" (a high-severity alert with no precise
      // location, e.g. buoy-physics-only maritime fog, used to fill the entire
      // sector bbox over every low-altitude cell). The banner alert still
      // informs the user; we just don't draw a misleading sector-wide blob.
      // (This also fixes the "no cargaba bien" lag — the full-sector path
      // sampled ~12k cells.)
      const sources = fogMeta?.sources ?? [];
      if (sources.length === 0) {
        if (!ac.signal.aborted) setFogGeoJSON(null);
        return;
      }
      const data = await sampleFogZonesLocal(queryElev, sources, config, fogType, ac.signal);

      if (ac.signal.aborted) return; // newer build raced past us
      if (data.features.length >= MIN_CLUSTER_POINTS) {
        setFogGeoJSON(data);
      }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return; // expected on rebuild
      throw err;
    }
  }, [mapRef, config, sectorId, fogType, fogMeta?.sources]);

  useEffect(() => {
    if (!active) {
      setFogGeoJSON(null);
      return;
    }
    setFogGeoJSON(null);
    // Reset throttle so the first build after (re)activation isn't blocked
    lastBuildAtRef.current = 0;

    const map = mapRef?.getMap();
    if (!map) return;

    const timer = setTimeout(() => { void buildFogZones(); }, 3000);
    const onTerrain = () => { setTimeout(() => { void buildFogZones(); }, 500); };
    map.once('terrain', onTerrain);

    return () => {
      clearTimeout(timer);
      map.off('terrain', onTerrain);
      buildAbortRef.current?.abort();
    };
  }, [active, sectorId, buildFogZones, mapRef]);

  // Retain last valid fogGeoJSON so fade-out animates on dissipation
  useEffect(() => {
    if (fogGeoJSON) lastFogRef.current = fogGeoJSON;
  }, [fogGeoJSON]);

  // Fade in/out transition (placebo growth/dissipation effect)
  // - appearing: 2s ease-in (fog forms quickly once detected)
  // - dissipating: 5s ease-out (fog lifts slowly, like real marine fog burning off)
  // Throttled to 20fps (50ms gate) — same reason as breathing pulse: setState
  // at full 60fps re-renders FogOverlay → MapLibre re-processes Source GeoJSON
  // → CPU spike. 20fps fade is still visually smooth (S136+3 audit #11).
  useEffect(() => {
    const shouldShow = active && fogGeoJSON != null;
    const target = shouldShow ? 1 : 0;
    const startT = Date.now();
    const startV = fadeOpacity;
    const delta = target - startV;
    if (Math.abs(delta) < 0.01) return;
    const duration = delta > 0 ? 2000 : 5000;
    let frame: number;
    let lastUpdate = 0;
    const FADE_GATE_MS = 50;
    const tick = () => {
      if (document.hidden) { frame = requestAnimationFrame(tick); return; }
      const now = Date.now();
      if (now - lastUpdate >= FADE_GATE_MS) {
        lastUpdate = now;
        const elapsed = now - startT;
        const progress = Math.min(1, elapsed / duration);
        // easeInOutCubic
        const eased = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        setFadeOpacity(startV + delta * eased);
        if (progress >= 1) return; // done, stop scheduling
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps — fadeOpacity intentionally read as start value, not tracked
  }, [active, fogGeoJSON != null]);

  // Keep rendering during fade-out by falling back to last valid features
  const renderGeoJSON = fogGeoJSON ?? (fadeOpacity > 0.01 ? lastFogRef.current : null);
  if (!renderGeoJSON || fadeOpacity < 0.01) return null;
  const finalOpacity = FOG_BASE_OPACITY * fadeOpacity;

  return (
    <Source id="fog-overlay" type="geojson" data={renderGeoJSON}>
      {/* Fog fill — per-cell density × constant base opacity × fade transition */}
      <Layer
        id="fog-fill"
        type="fill"
        paint={{
          'fill-color': ['get', 'color'],
          'fill-opacity': ['*', ['get', 'density'], finalOpacity],
          'fill-antialias': false,
        }}
      />
      {/* Soft outer glow that merges adjacent fog cells (without it the density
        buckets show as a "mini-cuadrados" mosaic). line-blur reduced 14→8: a
        wide blurred line re-rasterizes on every pan frame and the kernel cost
        scales with the blur radius — 8 still merges the cells but is cheaper. */}
      <Layer
        id="fog-glow"
        type="line"
        paint={{
          'line-color': config.glowColor,
          'line-width': 10,
          'line-blur': 8,
          'line-opacity': finalOpacity * 0.3,
        }}
      />
    </Source>
  );
}

export const FogOverlay = memo(FogOverlayInner);
