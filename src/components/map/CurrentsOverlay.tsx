import { useEffect, useState, memo } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { useSectorStore } from '../../store/sectorStore';

/**
 * RADAR ON RAIA — HF Radar surface currents overlay (INTECMAR / Puertos del Estado).
 *
 * WMS from THREDDS server at opendap.intecmar.gal
 * Dataset: HFRADAR_Galicia_Aggr_NRT_v2.2_Totals (NRT aggregated)
 * Layer: sea_water_velocity (auto-generated vector field from EWCT + NSCT)
 * Style: fancyvec/rainbow (fancy vector arrows with rainbow speed palette)
 * Resolution: hourly, ~2h lag from real-time
 * Coverage: entire Galician coast (-11.3°W to -8°E, 40.4°N to 44.7°N)
 * License: CC BY 4.0 (INTECMAR / Puertos del Estado)
 *
 * Only rendered in Rías Baixas sector (no coastal current data inland).
 */

// ── Config ──────────────────────────────────────────

const WMS_BASE = '/hfradar-api';

/** Coverage area for the HF radar (entire Galician coast) */
const BBOX = {
  west: -11.33,
  south: 40.35,
  east: -7.97,
  north: 44.68,
};

/** Image corners for MapLibre (top-left, top-right, bottom-right, bottom-left) */
const IMAGE_COORDINATES: [[number, number], [number, number], [number, number], [number, number]] = [
  [BBOX.west, BBOX.north],
  [BBOX.east, BBOX.north],
  [BBOX.east, BBOX.south],
  [BBOX.west, BBOX.south],
];

/** Refresh every 30 min (data updates hourly, ~2h lag) */
const REFRESH_INTERVAL = 30 * 60 * 1000;

function buildCurrentsUrl(): string {
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: 'sea_water_velocity',
    styles: 'fancyvec/rainbow',
    crs: 'CRS:84',
    bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`,
    width: '768',
    height: '768',
    format: 'image/png',
    transparent: 'true',
    time: 'current',
    elevation: '-0.0',
  });
  // Cache buster — changes every 30 min to match refresh interval
  const t = Math.floor(Date.now() / REFRESH_INTERVAL);
  params.set('_t', String(t));
  return `${WMS_BASE}?${params.toString()}`;
}

// ── Component ───────────────────────────────────────

export const CurrentsOverlay = memo(function CurrentsOverlay() {
  const { current: mapInstance } = useMap();
  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const opacity = useWeatherLayerStore((s) => s.layerOpacity);
  const activeSector = useSectorStore((s) => s.activeSector);

  const isActive = activeLayer === 'currents' && activeSector.id === 'rias';
  const [currentsUrl, setCurrentsUrl] = useState<string | null>(null);

  // Fetch on activation + periodic refresh
  useEffect(() => {
    if (!isActive) {
      setCurrentsUrl(null);
      return;
    }

    setCurrentsUrl(buildCurrentsUrl());

    const timer = setInterval(() => {
      setCurrentsUrl(buildCurrentsUrl());
    }, REFRESH_INTERVAL);

    return () => clearInterval(timer);
  }, [isActive]);

  // Update image source when URL changes (prevents MapLibre stale source)
  useEffect(() => {
    if (!isActive || !currentsUrl || !mapInstance) return;

    const map = mapInstance.getMap();
    if (!map) return;

    const source = map.getSource('currents-image') as maplibregl.ImageSource | undefined;
    if (source) {
      source.updateImage({
        url: currentsUrl,
        coordinates: IMAGE_COORDINATES,
      });
    }
  }, [isActive, currentsUrl, mapInstance]);

  if (!isActive || !currentsUrl) return null;

  return (
    <Source
      id="currents-image"
      type="image"
      url={currentsUrl}
      coordinates={IMAGE_COORDINATES}
    >
      <Layer
        id="currents-raster"
        type="raster"
        paint={{
          'raster-opacity': opacity,
          'raster-fade-duration': 500,
        }}
      />
    </Source>
  );
});
