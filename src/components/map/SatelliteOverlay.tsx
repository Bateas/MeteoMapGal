import { useEffect, useState, useRef, useCallback, memo } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';

/**
 * EUMETSAT Meteosat satellite cloud imagery overlay.
 * Uses free WMS from view.eumetsat.int (no auth required).
 *
 * Layer: msg_fes:ir108 — Infrared 10.8μm channel
 *   - Works 24h (day + night)
 *   - Updates every 15 min
 *   - Bright = cold cloud tops (cumulonimbus), Dark = clear/warm ground
 *
 * Rendered as MapLibre native raster source.
 *
 * Error handling:
 *   - Pre-validates image URL with fetch() before passing to MapLibre
 *   - Retries with exponential backoff (10s, 30s, 60s)
 *   - Shows status indicator via loadStatus state
 */

// ── Config ──────────────────────────────────────────────

const EUMETSAT_WMS = '/eumetsat-api/geoserver/msg_fes/wms';

/** Bounding box covering Galicia + surrounding area (EPSG:4326) */
const BBOX = {
  west: -10.5,
  south: 40.5,
  east: -5.5,
  north: 44.5,
};

/** Image coordinates for MapLibre (top-left, top-right, bottom-right, bottom-left) */
const IMAGE_COORDINATES: [[number, number], [number, number], [number, number], [number, number]] = [
  [BBOX.west, BBOX.north],  // top-left
  [BBOX.east, BBOX.north],  // top-right
  [BBOX.east, BBOX.south],  // bottom-right
  [BBOX.west, BBOX.south],  // bottom-left
];

/** Refresh interval — 5 min (EUMETSAT updates every 15 min) */
const REFRESH_INTERVAL = 5 * 60 * 1000;

/** Retry delays in ms — exponential backoff */
const RETRY_DELAYS = [10_000, 30_000, 60_000];

// ── URL builder ─────────────────────────────────────────

function buildSatelliteUrl(): string {
  // Use CRS:84 (lon/lat order) which matches our bbox
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: 'msg_fes:ir108',
    crs: 'CRS:84',
    bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`,
    width: '512',
    height: '512',
    format: 'image/png',
    transparent: 'true',
  });

  // Append cache-busting timestamp (rounded to 15min for cache friendliness)
  const now = new Date();
  const rounded = new Date(Math.floor(now.getTime() / (15 * 60 * 1000)) * (15 * 60 * 1000));
  params.set('time', rounded.toISOString());

  return `${EUMETSAT_WMS}?${params.toString()}`;
}

// ── Component ───────────────────────────────────────────

export type SatelliteLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export const SatelliteOverlay = memo(function SatelliteOverlay() {
  const { current: mapInstance } = useMap();
  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const opacity = useWeatherLayerStore((s) => s.layerOpacity);

  const isActive = activeLayer === 'satellite';

  // Auto-refresh URL on interval
  const [satelliteUrl, setSatelliteUrl] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<SatelliteLoadStatus>('idle');
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up retry timer
  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  /**
   * Validate URL with a HEAD fetch before passing to MapLibre.
   * On failure, schedule a retry with exponential backoff.
   */
  const loadSatelliteImage = useCallback(async () => {
    const url = buildSatelliteUrl();
    setLoadStatus('loading');

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // URL is valid — set it for MapLibre to load
      setSatelliteUrl(url);
      setLoadStatus('loaded');
      retryCountRef.current = 0;
    } catch {
      // Schedule retry if we haven't exhausted attempts
      if (retryCountRef.current < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[retryCountRef.current];
        retryCountRef.current++;
        setLoadStatus('error');
        retryTimerRef.current = setTimeout(loadSatelliteImage, delay);
      } else {
        // All retries exhausted — stay in error, wait for next REFRESH_INTERVAL
        setLoadStatus('error');
        retryCountRef.current = 0;
      }
    }
  }, []);

  // Visibility-aware polling — pauses when tab is hidden
  useVisibilityPolling(
    () => {
      clearRetryTimer();
      retryCountRef.current = 0;
      loadSatelliteImage();
    },
    REFRESH_INTERVAL,
    isActive,
  );

  // Cleanup when deactivated
  useEffect(() => {
    if (!isActive) {
      setSatelliteUrl(null);
      setLoadStatus('idle');
      clearRetryTimer();
      retryCountRef.current = 0;
    }
  }, [isActive, clearRetryTimer]);

  // Update image source when URL changes (for refresh)
  useEffect(() => {
    if (!isActive || !satelliteUrl || !mapInstance) return;

    const map = mapInstance.getMap();
    if (!map) return;

    // Wait for map to be loaded before accessing source
    const updateSource = () => {
      const source = map.getSource('satellite-image') as maplibregl.ImageSource | undefined;
      if (source) {
        source.updateImage({
          url: satelliteUrl,
          coordinates: IMAGE_COORDINATES,
        });
      }
    };

    if (map.loaded()) {
      updateSource();
    } else {
      map.once('load', updateSource);
    }
  }, [isActive, satelliteUrl, mapInstance]);

  if (!isActive || !satelliteUrl) return null;

  return (
    <>
      <Source
        id="satellite-image"
        type="image"
        url={satelliteUrl}
        coordinates={IMAGE_COORDINATES}
      >
        <Layer
          id="satellite-raster"
          type="raster"
          paint={{
            'raster-opacity': opacity,
            'raster-fade-duration': 500,
          }}
        />
      </Source>

      {/* Status indicator overlay */}
      {loadStatus === 'error' && (
        <div
          className="absolute top-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none
                     bg-red-900/80 text-white text-xs px-3 py-1.5 rounded-full"
        >
          Error cargando satélite · reintentando…
        </div>
      )}
      {loadStatus === 'loading' && !satelliteUrl && (
        <div
          className="absolute top-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none
                     bg-slate-800/80 text-white text-xs px-3 py-1.5 rounded-full"
        >
          Cargando imagen satélite…
        </div>
      )}
    </>
  );
});
