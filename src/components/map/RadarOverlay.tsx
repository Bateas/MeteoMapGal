import { useEffect, useState, useRef, useCallback, memo } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { fetchRadarImageUrl } from '../../api/aemetRadarClient';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';

/**
 * AEMET Radar overlay — Radar de Cuntis (Galicia) regional composite.
 *
 * The AEMET regional radar PNG covers a ~240km radius centered on Cuntis.
 * Image is roughly 480×480px covering NW Iberia.
 *
 * Approximate geo-referenced bounds (EPSG:4326) for the Galicia regional radar:
 *   West: -11.5, East: -4.5, North: 45.0, South: 40.0
 *
 * Updates every 10 min (we poll every 5 min to catch fresh images).
 * Rendered as MapLibre native image source, same pattern as SatelliteOverlay.
 *
 * Error handling: retry with exponential backoff (10s, 30s, 60s) + user banner.
 */

// ── Config ──────────────────────────────────────────

/** Bounds for AEMET Galicia regional radar (ga) — Cuntis at ~42.75°N -8.5°W, 240km radius.
 * Original empirical values that worked in production. Calculated values [-11.44, 40.59, -5.56, 44.91]
 * need verification with actual radar PNG metadata before applying. */
const BBOX = {
  west: -11.5,
  south: 40.0,
  east: -4.5,
  north: 45.0,
};

/** Image coordinates for MapLibre (top-left, top-right, bottom-right, bottom-left) */
const IMAGE_COORDINATES: [[number, number], [number, number], [number, number], [number, number]] = [
  [BBOX.west, BBOX.north],
  [BBOX.east, BBOX.north],
  [BBOX.east, BBOX.south],
  [BBOX.west, BBOX.south],
];

/** Refresh interval — 5 min (AEMET radar updates every 10 min) */
const REFRESH_INTERVAL = 5 * 60 * 1000;

/** Retry delays for exponential backoff */
const RETRY_DELAYS = [10_000, 30_000, 60_000];

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

// ── Component ───────────────────────────────────────

export const RadarOverlay = memo(function RadarOverlay() {
  const { current: mapInstance } = useMap();
  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const opacity = useWeatherLayerStore((s) => s.layerOpacity);

  const isActive = activeLayer === 'radar';

  const [radarUrl, setRadarUrl] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>();

  /** Fetch radar image with error handling + retry */
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
      // Schedule retry with exponential backoff
      const attempt = retryCountRef.current;
      if (attempt < RETRY_DELAYS.length) {
        retryTimerRef.current = setTimeout(() => {
          retryCountRef.current = attempt + 1;
          loadRadar();
        }, RETRY_DELAYS[attempt]);
      }
    }
  }, []);

  // Visibility-aware polling — pauses when tab is hidden
  useVisibilityPolling(
    () => {
      retryCountRef.current = 0;
      clearTimeout(retryTimerRef.current);
      loadRadar();
    },
    REFRESH_INTERVAL,
    isActive,
  );

  // Cleanup when deactivated
  useEffect(() => {
    if (!isActive) {
      setRadarUrl(null);
      setLoadStatus('idle');
      retryCountRef.current = 0;
      clearTimeout(retryTimerRef.current);
    }
  }, [isActive]);

  // Cleanup on unmount
  useEffect(() => () => clearTimeout(retryTimerRef.current), []);

  // Update image source when URL changes
  useEffect(() => {
    if (!isActive || !radarUrl || !mapInstance) return;

    const map = mapInstance.getMap();
    if (!map) return;

    const source = map.getSource('radar-image') as maplibregl.ImageSource | undefined;
    if (source) {
      source.updateImage({
        url: radarUrl,
        coordinates: IMAGE_COORDINATES,
      });
    }
  }, [isActive, radarUrl, mapInstance]);

  if (!isActive) return null;

  return (
    <>
      {radarUrl && (
        <Source
          id="radar-image"
          type="image"
          url={radarUrl}
          coordinates={IMAGE_COORDINATES}
        >
          <Layer
            id="radar-raster"
            type="raster"
            paint={{
              'raster-opacity': opacity,
              'raster-fade-duration': 500,
            }}
          />
        </Source>
      )}

      {/* Error banner */}
      {loadStatus === 'error' && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="bg-red-900/80 text-red-200 text-xs px-3 py-1.5 rounded-full backdrop-blur-sm border border-red-700/50">
            Error cargando radar · reintentando…
          </div>
        </div>
      )}

      {/* Loading banner (first load only) */}
      {loadStatus === 'loading' && !radarUrl && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="bg-slate-800/80 text-slate-300 text-xs px-3 py-1.5 rounded-full backdrop-blur-sm border border-slate-600/50">
            Cargando imagen radar…
          </div>
        </div>
      )}
    </>
  );
});
