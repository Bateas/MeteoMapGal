import { useEffect, useState, useRef, useCallback, memo } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { fetchRainViewerFrames, buildTileUrl, type RainViewerFrame } from '../../api/rainviewerClient';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
/**
 * Radar overlay — RainViewer tiles, the past 2 h. The free tier has no forecast frames.
 *
 * Uses native MapLibre raster tiles for smooth pan/zoom performance.
 * Shows most recent frame by default. Animation: play/pause + frame slider.
 * RainViewer max useful zoom ~7 (upscaled beyond). Free tier, no API key.
 *
 * Previous: dual AEMET image + RainViewer. AEMET national composite PNG
 * caused alignment issues (header offset) and severe perf degradation
 * (single large image reprojected every frame). Removed in v1.38.0.
 */

const REFRESH_INTERVAL = 5 * 60 * 1000;
const ANIMATION_SPEED = 600; // ms per frame
// Frames older than this are treated as stale even if the cache is fresh.
// RainViewer publishes every ~10 min; >30 min means the upstream is stuck or
// the API has been failing silently while we kept polling.
const STALE_FRAME_AGE_MS = 30 * 60 * 1000;

// ── Component ─────────────────────────────────────────
export const RadarOverlay = memo(function RadarOverlay() {
  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const opacity = useWeatherLayerStore((s) => s.layerOpacity);
  const isActive = activeLayer === 'radar';

  // RainViewer state
  const [rvHost, setRvHost] = useState('');
  const [frames, setFrames] = useState<RainViewerFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [radarError, setRadarError] = useState<string | null>(null);
  const failCountRef = useRef(0);
  const animTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // ── RainViewer fetch ──
  // `manual = true` → user-initiated retry. Surface error after 1 fail (not 3)
  // so the user gets immediate feedback instead of silent "nothing happens".
  const loadRainViewer = useCallback(async (manual = false) => {
    setLoading(true);
    try {
      const data = await fetchRainViewerFrames();
      // Detect "stuck" upstream: API responds with frames but they're all stale.
      // Without this guard we'd keep showing 1h-old radar tiles thinking the
      // refresh succeeded, which is exactly the "se queda dias pillado" symptom.
      const newestFrameTimeMs = data?.past.length
        ? data.past[data.past.length - 1].time * 1000
        : 0;
      const isFresh = newestFrameTimeMs > 0 && Date.now() - newestFrameTimeMs < STALE_FRAME_AGE_MS;

      if (data && data.past.length > 0 && isFresh) {
        setRvHost(data.host);
        setFrames(data.past);
        setFrameIndex(data.past.length - 1);
        setRadarError(null);
        failCountRef.current = 0;
      } else {
        // Either no frames at all OR newest frame is stale. Count both as failures
        // (regardless of whether we have cached frames showing — old radar lying
        // is worse than a clear error message).
        failCountRef.current++;
        const threshold = manual ? 1 : 3;
        if (failCountRef.current >= threshold) {
          setRadarError(
            data && data.past.length > 0
              ? 'Radar desactualizado: RainViewer no responde'
              : 'Radar no disponible',
          );
        }
      }
    } catch {
      failCountRef.current++;
      const threshold = manual ? 1 : 3;
      if (failCountRef.current >= threshold) {
        setRadarError('Error cargando radar');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Polling
  useVisibilityPolling(loadRainViewer, REFRESH_INTERVAL, isActive);

  // Cleanup when deactivated
  useEffect(() => {
    if (!isActive) {
      setPlaying(false);
      setFrames([]);
      setRvHost('');
      clearInterval(animTimerRef.current);
    }
  }, [isActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearInterval(animTimerRef.current);
  }, []);

  // Animation playback
  useEffect(() => {
    clearInterval(animTimerRef.current);
    if (playing && frames.length > 0) {
      animTimerRef.current = setInterval(() => {
        if (document.hidden) return; // Skip frame advance when tab is backgrounded
        setFrameIndex((prev) => (prev + 1) % frames.length);
      }, ANIMATION_SPEED);
    }
    return () => clearInterval(animTimerRef.current);
  }, [playing, frames.length]);

  if (!isActive) return null;

  const currentFrame = frames[frameIndex];
  const currentTileUrl = currentFrame ? buildTileUrl(rvHost, currentFrame.path) : null;

  // Says how old the NEWEST frame is when it is suspiciously old, before any error fires. Not the frame on
  // screen: dragging the slider back to a frame from two hours ago is not RainViewer being down.
  const newestFrame = frames.length > 0 ? frames[frames.length - 1] : null;
  const newestAgeMin = newestFrame ? Math.round((Date.now() - newestFrame.time * 1000) / 60_000) : 0;
  const showStaleHint = newestFrame != null && newestAgeMin > 20;
  const frameTime = currentFrame ? formatFrameTime(currentFrame.time) : '--:--';

  return (
    <>
      {/* ── RainViewer radar tiles ── */}
      {currentTileUrl && (
        <RainViewerLayer tileUrl={currentTileUrl} opacity={opacity} />
      )}

      {/* ── Player ── */}
      {frames.length > 0 && (
        <div className="g-theme gc-popover gc-mapbar gc-mapbar--player" role="group" aria-label="Radar: últimas 2 horas">
          <button
            type="button"
            onClick={() => setPlaying(!playing)}
            className="gc-btn gc-btn--plain gc-btn--icon"
            aria-label={playing ? 'Pausar animación' : 'Reproducir animación'}
          >
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1" width="3" height="10" fill="currentColor" /><rect x="7" y="1" width="3" height="10" fill="currentColor" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><polygon points="2,1 11,6 2,11" fill="currentColor" /></svg>
            )}
          </button>
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={frameIndex}
            onChange={(e) => { setFrameIndex(Number(e.target.value)); setPlaying(false); }}
            aria-label="Fotograma del radar"
            aria-valuetext={frameTime}
          />
          <span className="gc-num">{frameTime}</span>
          {showStaleHint && (
            <span className="gc-note-strong" title={`El último fotograma es de hace ${newestAgeMin} min: RainViewer puede estar caído.`}>
              hace {newestAgeMin} min
            </span>
          )}
        </div>
      )}

      {/* First load or a retry in flight */}
      {loading && frames.length === 0 && (
        <div className="g-theme gc-hint gc-mapbar" role="status">
          {failCountRef.current > 0 ? 'Reintentando radar…' : 'Cargando radar…'}
        </div>
      )}
      {radarError && frames.length === 0 && !loading && (
        <div className="g-theme gc-hint gc-mapbar" role="status">
          <span>{radarError}</span>
          <button
            type="button"
            onClick={() => { setRadarError(null); failCountRef.current = 0; loadRainViewer(true); }}
            className="gc-linkbtn"
            disabled={loading}
          >
            Reintentar
          </button>
        </div>
      )}
    </>
  );
});

const SOURCE_ID = 'rainviewer-tiles';
const LAYER_ID = 'rainviewer-raster';

/**
 * Adds the radar source and layer when missing (first mount, or after a setStyle wiped them).
 * False while the style is still loading: MapLibre then throws «Style is not done loading», and
 * with the radar animating every half second a base-map or theme switch hit that window and the
 * whole map fell to its error screen (seen in production on 29-oct). The style.load listener
 * installs it as soon as the style is ready.
 */
export function installRadarLayer(
  map: Pick<maplibregl.Map, 'getSource' | 'addSource' | 'addLayer'>,
  tileUrl: string,
  opacity: number,
): boolean {
  if (map.getSource(SOURCE_ID)) return true;
  try {
    map.addSource(SOURCE_ID, { type: 'raster', tiles: [tileUrl], tileSize: 256, maxzoom: 7 });
    map.addLayer({
      id: LAYER_ID,
      type: 'raster',
      source: SOURCE_ID,
      paint: { 'raster-opacity': opacity, 'raster-fade-duration': 300 },
    });
    return true;
  } catch (err) {
    if (/not done loading/i.test(String(err))) return false;
    throw err;
  }
}

/** RainViewer tile layer — updates tiles via map API without remounting */
function RainViewerLayer({ tileUrl, opacity }: { tileUrl: string; opacity: number }) {
  const { current: mapInstance } = useMap();
  // The latest frame and opacity, read by the installer. Until 6-oct the installer was a callback of
  // [tileUrl, opacity] and the effect that ran it cleaned up on every change: each animation step
  // REMOVED the source and added it again (tiles dropped, decoded and uploaded anew several times a
  // second) instead of swapping its tiles.
  const tileUrlRef = useRef(tileUrl);
  const opacityRef = useRef(opacity);
  tileUrlRef.current = tileUrl;
  opacityRef.current = opacity;

  // Idempotent, and waits for the style instead of throwing (installRadarLayer).
  const installLayer = useCallback((map: maplibregl.Map) => {
    installRadarLayer(map, tileUrlRef.current, opacityRef.current);
  }, []);

  // Mount / unmount only.
  useEffect(() => {
    if (!mapInstance) return;
    const map = mapInstance.getMap();
    if (!map) return;
    installLayer(map);
    return () => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [mapInstance, installLayer]);

  // A new frame swaps the tiles of the same source.
  useEffect(() => {
    const map = mapInstance?.getMap();
    if (!map) return;
    const src = map.getSource(SOURCE_ID) as maplibregl.RasterTileSource | undefined;
    if (src?.setTiles) src.setTiles([tileUrl]);
    else installLayer(map);
  }, [mapInstance, tileUrl, installLayer]);

  useEffect(() => {
    const map = mapInstance?.getMap();
    if (map?.getLayer(LAYER_ID)) map.setPaintProperty(LAYER_ID, 'raster-opacity', opacity);
  }, [mapInstance, opacity]);

  // Re-apply source + layer after any setStyle (audit finding):
  // MapLibre wipes all sources/layers on a style rebuild (base-map change)
  // and the effects above do NOT re-run because nothing they depend on
  // changed. Without this listener the radar disappears silently when the
  // user switches the base map while radar is active.
  useEffect(() => {
    if (!mapInstance) return;
    const map = mapInstance.getMap();
    if (!map) return;
    const reapply = () => installLayer(map);
    map.on('style.load', reapply);
    return () => { map.off('style.load', reapply); };
  }, [mapInstance, installLayer]);

  return null;
}

function formatFrameTime(unixTs: number): string {
  const d = new Date(unixTs * 1000);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
