import { useEffect, useState, useRef, useCallback, memo } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { fetchRainViewerFrames, buildTileUrl, type RainViewerFrame } from '../../api/rainviewerClient';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { WeatherIcon } from '../icons/WeatherIcons';

/**
 * Radar overlay — RainViewer tiles (past 2h + nowcast 30min).
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

// ── Component ─────────────────────────────────────────
export const RadarOverlay = memo(function RadarOverlay() {
  const { current: mapInstance } = useMap();
  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const opacity = useWeatherLayerStore((s) => s.layerOpacity);
  const isActive = activeLayer === 'radar';

  // RainViewer state
  const [rvHost, setRvHost] = useState('');
  const [frames, setFrames] = useState<RainViewerFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const animTimerRef = useRef<ReturnType<typeof setInterval>>();

  // ── RainViewer fetch ──
  const loadRainViewer = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchRainViewerFrames();
      if (data && data.past.length > 0) {
        setRvHost(data.host);
        const allFrames = [...data.past, ...data.nowcast];
        setFrames(allFrames);
        // Start at last past frame (most recent actual data)
        setFrameIndex(data.past.length - 1);
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
        setFrameIndex((prev) => (prev + 1) % frames.length);
      }, ANIMATION_SPEED);
    }
    return () => clearInterval(animTimerRef.current);
  }, [playing, frames.length]);

  if (!isActive) return null;

  const currentFrame = frames[frameIndex];
  const currentTileUrl = currentFrame ? buildTileUrl(rvHost, currentFrame.path) : null;

  return (
    <>
      {/* ── RainViewer radar tiles ── */}
      {currentTileUrl && (
        <RainViewerLayer tileUrl={currentTileUrl} opacity={opacity} />
      )}

      {/* ── Controls (bottom-center over map) ── */}
      {frames.length > 0 && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
          <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/50 rounded-xl px-3 py-2 flex items-center gap-2 shadow-lg">
            {/* Play/Pause */}
            <button
              onClick={() => setPlaying(!playing)}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              aria-label={playing ? 'Pausar animación' : 'Reproducir animación'}
            >
              {playing ? (
                <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" fill="currentColor" /><rect x="7" y="1" width="3" height="10" fill="currentColor" /></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="2,1 11,6 2,11" fill="currentColor" /></svg>
              )}
            </button>

            {/* Frame slider */}
            <input
              type="range"
              min={0}
              max={frames.length - 1}
              value={frameIndex}
              onChange={(e) => { setFrameIndex(Number(e.target.value)); setPlaying(false); }}
              className="w-32 h-1 accent-sky-500 cursor-pointer"
              aria-label="Fotograma radar"
            />

            {/* Timestamp */}
            <span className="text-[11px] text-slate-400 font-mono w-12 text-center">
              {currentFrame ? formatFrameTime(currentFrame.time) : '--:--'}
            </span>

            {/* Nowcast indicator */}
            {currentFrame && frames.indexOf(currentFrame) >= frames.length - 3 && (
              <span className="text-[11px] text-amber-400 font-semibold">PREV</span>
            )}
          </div>
        </div>
      )}

      {/* Loading (first load only) */}
      {loading && frames.length === 0 && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="bg-slate-800/80 text-slate-300 text-xs px-3 py-1.5 rounded-full backdrop-blur-sm border border-slate-600/50">
            Cargando radar…
          </div>
        </div>
      )}
    </>
  );
});

/** RainViewer tile layer — updates tiles via map API without remounting */
function RainViewerLayer({ tileUrl, opacity }: { tileUrl: string; opacity: number }) {
  const { current: mapInstance } = useMap();

  useEffect(() => {
    if (!mapInstance) return;
    const map = mapInstance.getMap();
    if (!map) return;

    const sourceId = 'rainviewer-tiles';
    const layerId = 'rainviewer-raster';

    const existingSource = map.getSource(sourceId);
    if (existingSource) {
      // Update tiles URL
      (existingSource as maplibregl.RasterTileSource).setTiles?.([tileUrl]);
      // Fallback: remove and re-add if setTiles not available
      if (!(existingSource as maplibregl.RasterTileSource).setTiles) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        map.removeSource(sourceId);
      } else {
        // Update opacity
        if (map.getLayer(layerId)) {
          map.setPaintProperty(layerId, 'raster-opacity', opacity);
        }
        return;
      }
    }

    // Add new source + layer
    map.addSource(sourceId, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      maxzoom: 7,
    });
    map.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: { 'raster-opacity': opacity, 'raster-fade-duration': 300 },
    });

    return () => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [mapInstance, tileUrl, opacity]);

  return null;
}

function formatFrameTime(unixTs: number): string {
  const d = new Date(unixTs * 1000);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
