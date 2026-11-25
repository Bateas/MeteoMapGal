/**
 * FogOverlay — the fog on the map, one look whatever detected it (see fogField).
 *
 * - Per-point density: lower altitude = denser, and it falls with the distance to the detector
 * - Fade in/out transition on activation/dissipation (no perpetual animation)
 * - Sectors: Embalse (valley <185m) + Rías Baixas (coastal <35m)
 *
 * Paints fog alerts from alertStore plus the points of the official visibility sensors
 * (AemetVisibilityHalo). Ground altitude comes from the DEM tiles read directly (demElevation),
 * never from MapLibre terrain: terrain on a flat map made every pointer move and every marker read
 * pixels back from the GPU (30 s of a 40 s trace with fog on, 27-Sep).
 */
import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { loadElevationSampler, bboxAround } from '../../api/demElevation';
import { useSectorStore } from '../../store/sectorStore';
import { isCoastalSector } from '../../config/sectors';
import { useAlertStore } from '../../store/alertStore';
import type { UnifiedAlert } from '../../services/alerts/types';
import { useMapInk } from '../../hooks/useMapInk';
import { fogLattice, fogPoint, useFogFieldStore, FOG_HEATMAP_INTENSITY, FOG_HEATMAP_RADIUS, type FogPoint } from './fogField';
import { useFade } from './useFade';

// ── Config ──────────────────────────────────────────

/** Fog is a low thing: above this nothing is painted. */
const FOG_MAX_ALTITUDE_M = { inland: 185, coastal: 35 } as const;

const MIN_CLUSTER_POINTS = 8;

/** Each detector paints up to this far around itself (webcam visibility range in fog). */
const FOG_RADIUS_KM = 4;

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
// stays responsive when the detectors are far apart and the box is large.
const CHUNK_CELLS = 100;
const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0));

async function sampleFogPoints(
  queryElevation: (lngLat: { lng: number; lat: number }) => number | null,
  sources: { lat: number; lon: number }[],
  maxAltitude: number,
  signal?: AbortSignal,
): Promise<FogPoint[]> {
  // Tight bbox covering all sources + buffer
  const buffer = 0.05; // a bit over FOG_RADIUS_KM in degrees
  const lattice = fogLattice({
    west: Math.min(...sources.map(s => s.lon)) - buffer,
    east: Math.max(...sources.map(s => s.lon)) + buffer,
    south: Math.min(...sources.map(s => s.lat)) - buffer,
    north: Math.max(...sources.map(s => s.lat)) + buffer,
  });
  const points: FogPoint[] = [];
  let processed = 0;

  for (const { lng, lat } of lattice) {
    if (++processed % CHUNK_CELLS === 0) {
      await yieldToEventLoop();
      if (signal?.aborted) throw new DOMException('Fog build aborted', 'AbortError');
    }

    // perf: distance filter FIRST (cheap math), then elevation lookup (DEM read)
    let minDist = Infinity;
    for (const src of sources) {
      const d = distKm(lat, lng, src.lat, src.lon);
      if (d < minDist) minDist = d;
    }
    if (minDist > FOG_RADIUS_KM) continue; // outside any source's range

    // Maritime fog floats over water AND coastal lowlands; mountains SKIP.
    // null = the DEM tile could not be loaded: unknown ground is not
    // painted (it used to count as water and spill fog up the hills).
    // Sea reads as bathymetry (< 0) and counts as sea level.
    const elev = queryElevation({ lng, lat });
    if (elev === null || elev === undefined) continue;
    if (elev > maxAltitude) continue;
    const ground = Math.max(0, elev);

    // Density: falls with the distance, denser low down, and nothing at the edge or it reads as a disc
    const linearDist = Math.max(0, 1.0 - minDist / FOG_RADIUS_KM); // 1 at source, 0 at edge
    const altFactor = 1.0 - ground / maxAltitude; // sea level = 1, land falls with elevation
    const density = Math.min(1.0, linearDist * (linearDist * 0.8 + altFactor * 0.2));
    if (density < 0.08) continue;

    points.push(fogPoint(lng, lat, density));
  }

  return points;
}

// ── Component ───────────────────────────────────────

function FogOverlayInner() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const ink = useMapInk();
  const sensorPoints = useFogFieldStore((s) => s.sensorPoints);
  const [detectorPoints, setDetectorPoints] = useState<FogPoint[] | null>(null);
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
  const maxAltitude = coastal ? FOG_MAX_ALTITUDE_M.coastal : FOG_MAX_ALTITUDE_M.inland;
  const hasFogAlert = fogAlert != null;

  // The alert pipeline hands over a NEW sources array on every recompute even
  // when nothing moved; rebuilding on identity blanked the fog for seconds and
  // redid the whole grid. Rebuild only when a detector actually changes.
  const fogSources = fogMeta?.sources;
  const sourcesKey = useMemo(
    () => (fogSources ?? []).map((s) => `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`).sort().join('|'),
    [fogSources],
  );
  const sourcesRef = useRef(fogSources ?? []);
  sourcesRef.current = fogSources ?? [];

  // Debounce activation: require fog alert for 2s before rendering overlay.
  // Prevents flash on page load from transient partial-data fog detection.
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!hasFogAlert) { setActive(false); return; }
    const timer = setTimeout(() => setActive(true), 2000);
    return () => clearTimeout(timer);
  }, [hasFogAlert]);

  // Cancel any in-flight async build when a new one starts (sector change,
  // sources update, unmount). Avoids stale GeoJSON landing after a newer
  // build was requested.
  const buildAbortRef = useRef<AbortController | null>(null);

  const buildFogZones = useCallback(async () => {
    // Cancel previous build and start a new one
    buildAbortRef.current?.abort();
    const ac = new AbortController();
    buildAbortRef.current = ac;

    try {
      // LOCALIZED sampling ONLY: paint ~4km blobs around real detector sources.
      // If there are no localized sources we do NOT blanket the whole sector —
      // that painted fog "donde no era" (a high-severity alert with no precise
      // location, e.g. buoy-physics-only maritime fog, used to fill the entire
      // sector bbox over every low-altitude cell). The banner alert still
      // informs the user; we just don't draw a misleading sector-wide blob.
      // (This also fixes the "no cargaba bien" lag — the full-sector path
      // sampled ~12k cells.)
      const sources = sourcesRef.current;
      if (sources.length === 0) {
        if (!ac.signal.aborted) setDetectorPoints(null);
        return;
      }
      // Only the DEM tiles around the detectors (1-4 per source, cached).
      const elevAt = await loadElevationSampler(
        sources.map((s) => bboxAround(s.lat, s.lon, FOG_RADIUS_KM)),
      );
      if (ac.signal.aborted) return;
      const queryElev = ({ lng, lat }: { lng: number; lat: number }) => elevAt(lng, lat);
      const points = await sampleFogPoints(queryElev, sources, maxAltitude, ac.signal);

      if (ac.signal.aborted) return; // newer build raced past us
      // Too little to draw (or the ground could not be read): draw nothing
      // rather than keep a previous build that no longer matches the sources.
      setDetectorPoints(points.length >= MIN_CLUSTER_POINTS ? points : null);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return; // expected on rebuild
      throw err;
    }
    // sourcesKey stands in for the sources array (read through sourcesRef)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxAltitude, sourcesKey]);

  // A sector switch must not carry the other sector's fog across.
  useEffect(() => {
    setDetectorPoints(null);
    lastFogRef.current = null;
  }, [sectorId]);

  useEffect(() => {
    if (!active) {
      setDetectorPoints(null);
      return;
    }
    // No wait for tiles any more: the build loads the DEM it needs itself.
    void buildFogZones();
    return () => { buildAbortRef.current?.abort(); };
  }, [active, buildFogZones]);

  // One field: what the detectors say and what the official sensors say, in one source.
  const fogGeoJSON = useMemo<GeoJSON.FeatureCollection | null>(() => {
    const features = [...(detectorPoints ?? []), ...sensorPoints];
    return features.length > 0 ? { type: 'FeatureCollection', features } : null;
  }, [detectorPoints, sensorPoints]);

  // Retain the last field so fade-out animates on dissipation
  useEffect(() => {
    if (fogGeoJSON) lastFogRef.current = fogGeoJSON;
  }, [fogGeoJSON]);

  // Forms in 2 s, lifts in 5 s
  const fadeOpacity = useFade(fogGeoJSON != null);

  // Keep rendering during fade-out by falling back to last valid features
  const renderGeoJSON = fogGeoJSON ?? (fadeOpacity > 0.01 ? lastFogRef.current : null);
  if (!renderGeoJSON || fadeOpacity < 0.01) return null;
  // Pale on a dark map, grey on a light one: a white veil on a pale map cannot be seen. It follows the map
  // drawn, not the theme, like the words (useMapInk).
  const rgb = ink.halo === '#ffffff' ? '71, 85, 105' : '226, 232, 240';

  return (
    <Source id="fog-overlay" type="geojson" data={renderGeoJSON}>
      <Layer
        id="fog-heat"
        type="heatmap"
        paint={{
          'heatmap-weight': ['get', 'density'],
          'heatmap-intensity': FOG_HEATMAP_INTENSITY,
          'heatmap-radius': FOG_HEATMAP_RADIUS,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, `rgba(${rgb}, 0)`,
            0.15, `rgba(${rgb}, 0.16)`,
            0.5, `rgba(${rgb}, 0.42)`,
            1, `rgba(${rgb}, 0.65)`,
          ],
          'heatmap-opacity': fadeOpacity,
        }}
      />
    </Source>
  );
}

export const FogOverlay = memo(FogOverlayInner);
