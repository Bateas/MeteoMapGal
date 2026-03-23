import { useEffect, useState, useRef, useCallback, memo } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { fetchRadarImageUrl } from '../../api/aemetRadarClient';
import { fetchRainViewerFrames, buildTileUrl, type RainViewerFrame } from '../../api/rainviewerClient';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { WeatherIcon } from '../icons/WeatherIcons';

/**
 * Radar overlay — dual source:
 * 1. AEMET national composite (static, high-res)
 * 2. RainViewer animated tiles (past 2h, 12 frames, max zoom 7)
 *
 * User toggles between static (AEMET) and animated (RainViewer) mode.
 * Animation: play/pause, frame slider, timestamp display.
 */

// ── AEMET Config ──────────────────────────────────────
// AEMET national composite covers Iberian Peninsula + Balearics.
// The PNG includes header/legend that offset the actual radar data.
// Calibrated empirically against Galician coastline (Mar 2026).
const BBOX = { west: -10.5, south: 34.8, east: 5.5, north: 44.2 };
const IMAGE_COORDINATES: [[number, number], [number, number], [number, number], [number, number]] = [
  [BBOX.west, BBOX.north], [BBOX.east, BBOX.north],
  [BBOX.east, BBOX.south], [BBOX.west, BBOX.south],
];
const REFRESH_INTERVAL = 5 * 60 * 1000;
const RETRY_DELAYS = [10_000, 30_000, 60_000];
const ANIMATION_SPEED = 600; // ms per frame

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

// ── Component ─────────────────────────────────────────
export const RadarOverlay = memo(function RadarOverlay() {
  const { current: mapInstance } = useMap();
  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const opacity = useWeatherLayerStore((s) => s.layerOpacity);
  const isActive = activeLayer === 'radar';

  // AEMET state
  const [radarUrl, setRadarUrl] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // RainViewer animation state
  const [mode, setMode] = useState<'static' | 'animated'>('static');
  const [rvHost, setRvHost] = useState('');
  const [frames, setFrames] = useState<RainViewerFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const animTimerRef = useRef<ReturnType<typeof setInterval>>();

  // ── AEMET fetch ──
  const loadRadar = useCallback(async () => {
    setLoadStatus('loading');
    try {
      const url = await fetchRadarImageUrl();
      if (url) {
        setRadarUrl(url);
        setLoadStatus('loaded');
        retryCountRef.current = 0;
      } else {
        throw new Error('No radar URL returned');
      }
    } catch {
      setLoadStatus('error');
      const attempt = retryCountRef.current;
      if (attempt < RETRY_DELAYS.length) {
        retryTimerRef.current = setTimeout(() => {
          retryCountRef.current = attempt + 1;
          loadRadar();
        }, RETRY_DELAYS[attempt]);
      }
    }
  }, []);

  // ── RainViewer fetch ──
  const loadRainViewer = useCallback(async () => {
    const data = await fetchRainViewerFrames();
    if (data && data.past.length > 0) {
      setRvHost(data.host);
      const allFrames = [...data.past, ...data.nowcast];
      setFrames(allFrames);
      // Start at last past frame (most recent)
      setFrameIndex(data.past.length - 1);
    }
  }, []);

  // Polling — fetches both sources when active
  useVisibilityPolling(
    () => {
      retryCountRef.current = 0;
      clearTimeout(retryTimerRef.current);
      loadRadar();
      loadRainViewer();
    },
    REFRESH_INTERVAL,
    isActive,
  );

  // Cleanup when deactivated
  useEffect(() => {
    if (!isActive) {
      setRadarUrl(null);
      setLoadStatus('idle');
      setMode('static');
      setPlaying(false);
      setFrames([]);
      retryCountRef.current = 0;
      clearTimeout(retryTimerRef.current);
      clearInterval(animTimerRef.current);
    }
  }, [isActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(retryTimerRef.current);
      clearInterval(animTimerRef.current);
    };
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

  // Update AEMET image source when URL changes
  useEffect(() => {
    if (!isActive || !radarUrl || !mapInstance || mode !== 'static') return;
    const map = mapInstance.getMap();
    if (!map) return;
    const source = map.getSource('radar-image') as maplibregl.ImageSource | undefined;
    if (source) {
      source.updateImage({ url: radarUrl, coordinates: IMAGE_COORDINATES });
    }
  }, [isActive, radarUrl, mapInstance, mode]);

  if (!isActive) return null;

  const currentFrame = frames[frameIndex];
  const currentTileUrl = currentFrame ? buildTileUrl(rvHost, currentFrame.path) : null;

  return (
    <>
      {/* ── Static AEMET radar ── */}
      {mode === 'static' && radarUrl && (
        <Source id="radar-image" type="image" url={radarUrl} coordinates={IMAGE_COORDINATES}>
          <Layer
            id="radar-raster"
            type="raster"
            paint={{ 'raster-opacity': opacity, 'raster-fade-duration': 500 }}
          />
        </Source>
      )}

      {/* ── Animated RainViewer tiles ── */}
      {mode === 'animated' && currentTileUrl && (
        <RainViewerLayer tileUrl={currentTileUrl} opacity={opacity} />
      )}

      {/* ── Animation controls (bottom-center over map) ── */}
      {mode === 'animated' && frames.length > 0 && (
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
              className="w-28 h-1 accent-sky-500 cursor-pointer"
              aria-label="Fotograma radar"
            />

            {/* Timestamp */}
            <span className="text-[10px] text-slate-400 font-mono w-12 text-center">
              {currentFrame ? formatFrameTime(currentFrame.time) : '--:--'}
            </span>

            {/* Back to static */}
            <button
              onClick={() => { setMode('static'); setPlaying(false); }}
              className="text-[9px] text-slate-500 hover:text-slate-300 px-1.5 py-0.5 rounded border border-slate-700/50 transition-colors"
              aria-label="Volver a radar estático"
            >
              AEMET
            </button>
          </div>
        </div>
      )}

      {/* ── Mode toggle (static mode — small button to switch to animated) ── */}
      {mode === 'static' && frames.length > 0 && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
          <button
            onClick={() => setMode('animated')}
            className="bg-slate-900/85 backdrop-blur-md border border-slate-700/50 rounded-full px-3 py-1.5 flex items-center gap-1.5 text-slate-400 hover:text-sky-400 transition-colors shadow-lg text-[10px]"
            aria-label="Activar animación radar"
          >
            <WeatherIcon id="radar" size={12} />
            <span>Animación 2h</span>
            <svg width="10" height="10" viewBox="0 0 12 12"><polygon points="2,1 11,6 2,11" fill="currentColor" /></svg>
          </button>
        </div>
      )}

      {/* Error banner */}
      {loadStatus === 'error' && mode === 'static' && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="bg-red-900/80 text-red-200 text-xs px-3 py-1.5 rounded-full backdrop-blur-sm border border-red-700/50">
            Error cargando radar · reintentando…
          </div>
        </div>
      )}

      {/* Loading banner (first load only) */}
      {loadStatus === 'loading' && !radarUrl && mode === 'static' && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="bg-slate-800/80 text-slate-300 text-xs px-3 py-1.5 rounded-full backdrop-blur-sm border border-slate-600/50">
            Cargando imagen radar…
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

    // If source exists, update tiles
    const existing = map.getSource(sourceId) as maplibregl.RasterTileSource | undefined;
    if (existing) {
      // MapLibre doesn't have setTiles — remove and re-add
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      map.removeSource(sourceId);
    }

    map.addSource(sourceId, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      maxzoom: 7,
      attribution: '<a href="https://www.rainviewer.com" target="_blank">RainViewer</a>',
    });

    map.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: {
        'raster-opacity': opacity,
        'raster-opacity-transition': { duration: 0, delay: 0 },
        'raster-fade-duration': 0,
      },
    });

    return () => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [tileUrl, mapInstance, opacity]);

  return null;
}

/** Format unix timestamp (seconds) to HH:MM local time */
function formatFrameTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
