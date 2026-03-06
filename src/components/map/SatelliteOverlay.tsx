import { useEffect, useState, memo } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';

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

export const SatelliteOverlay = memo(function SatelliteOverlay() {
  const { current: mapInstance } = useMap();
  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const opacity = useWeatherLayerStore((s) => s.layerOpacity);

  const isActive = activeLayer === 'satellite';

  // Auto-refresh URL on interval
  const [satelliteUrl, setSatelliteUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isActive) {
      setSatelliteUrl(null);
      return;
    }

    // Build initial URL
    setSatelliteUrl(buildSatelliteUrl());

    // Refresh periodically
    const timer = setInterval(() => {
      setSatelliteUrl(buildSatelliteUrl());
    }, REFRESH_INTERVAL);

    return () => clearInterval(timer);
  }, [isActive]);

  // Update image source when URL changes
  useEffect(() => {
    if (!isActive || !satelliteUrl || !mapInstance) return;

    const map = mapInstance.getMap();
    if (!map) return;

    const source = map.getSource('satellite-image') as maplibregl.ImageSource | undefined;
    if (source) {
      source.updateImage({
        url: satelliteUrl,
        coordinates: IMAGE_COORDINATES,
      });
    }
  }, [isActive, satelliteUrl, mapInstance]);

  if (!isActive || !satelliteUrl) return null;

  return (
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
  );
});
