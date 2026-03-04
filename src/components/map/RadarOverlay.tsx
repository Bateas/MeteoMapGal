import { useEffect, useState, memo } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { fetchRadarImageUrl } from '../../api/aemetRadarClient';

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
 */

// ── Config ──────────────────────────────────────────

/** Approximate bounds for AEMET Galicia regional radar (ga) */
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

// ── Component ───────────────────────────────────────

export const RadarOverlay = memo(function RadarOverlay() {
  const { current: mapInstance } = useMap();
  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const opacity = useWeatherLayerStore((s) => s.layerOpacity);

  const isActive = activeLayer === 'radar';

  const [radarUrl, setRadarUrl] = useState<string | null>(null);

  // Fetch radar URL on activation and refresh periodically
  useEffect(() => {
    if (!isActive) {
      setRadarUrl(null);
      return;
    }

    // Initial fetch
    fetchRadarImageUrl().then(setRadarUrl);

    // Periodic refresh
    const timer = setInterval(() => {
      fetchRadarImageUrl().then(setRadarUrl);
    }, REFRESH_INTERVAL);

    return () => clearInterval(timer);
  }, [isActive]);

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

  if (!isActive || !radarUrl) return null;

  return (
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
  );
});
