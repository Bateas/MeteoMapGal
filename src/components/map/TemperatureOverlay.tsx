import { useMemo, memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import type { LayerProps } from 'react-map-gl/maplibre';
import { useWeatherStore } from '../../store/weatherStore';
import { useTemperatureOverlayStore } from '../../store/temperatureOverlayStore';
import { useBuoyStore } from '../../store/buoyStore';
import { useSectorStore } from '../../store/sectorStore';
import { BUOY_COORDS_MAP } from '../../api/buoyClient';
import { temperatureColor } from '../../services/windUtils';
import { waterTempColor } from '../../services/buoyUtils';
import { extractAllStationTemps } from '../../services/lapseRateService';

// ── Empty GeoJSON for stable reference when overlay is off ──
const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

// ── Layer styles ────────────────────────────────────────────

/** Outer glow halo — large, blurred, very transparent */
const circleGlowLayer: LayerProps = {
  id: 'temp-circle-glow',
  type: 'circle',
  paint: {
    'circle-radius': [
      'interpolate', ['exponential', 2], ['zoom'],
      9, 10,
      11, 30,
      13, 70,
      15, 160,
    ],
    'circle-color': ['get', 'color'],
    'circle-opacity': 0.12,
    'circle-blur': 0.8,
  },
};

/** Inner solid circle — smaller, more opaque */
const circleCoreLayer: LayerProps = {
  id: 'temp-circle-core',
  type: 'circle',
  paint: {
    'circle-radius': [
      'interpolate', ['exponential', 2], ['zoom'],
      9, 5,
      11, 14,
      13, 35,
      15, 80,
    ],
    'circle-color': ['get', 'color'],
    'circle-opacity': 0.3,
    'circle-stroke-width': 1.5,
    'circle-stroke-color': ['get', 'color'],
    'circle-stroke-opacity': 0.45,
  },
};

/**
 * Temperature value label — positioned ABOVE the station marker so it
 * doesn't overlap with the marker icon or the map place name.
 */
const tempLabelLayer: LayerProps = {
  id: 'temp-label',
  type: 'symbol',
  layout: {
    'text-field': ['get', 'label'],
    'text-font': ['Open Sans Bold'],
    'text-size': ['interpolate', ['linear'], ['zoom'], 9, 11, 12, 15, 15, 22],
    'text-allow-overlap': true,
    'text-ignore-placement': true,
    'text-offset': [0, -1.8],
    'text-anchor': 'bottom',
  },
  paint: {
    'text-color': '#ffffff',
    'text-halo-color': 'rgba(0, 0, 0, 0.95)',
    'text-halo-width': 2.5,
  },
};

/**
 * Station name + altitude sub-label — positioned BELOW the station marker.
 * Only visible at higher zoom levels (fades in from zoom 11).
 */
const stationSubLabelLayer: LayerProps = {
  id: 'temp-station-sublabel',
  type: 'symbol',
  layout: {
    'text-field': ['get', 'sublabel'],
    'text-font': ['Open Sans Regular'],
    'text-size': ['interpolate', ['linear'], ['zoom'], 10, 0, 11, 8, 13, 10, 15, 13],
    'text-allow-overlap': true,
    'text-ignore-placement': true,
    'text-offset': [0, 2.2],
    'text-anchor': 'top',
  },
  paint: {
    'text-color': 'rgba(255, 255, 255, 0.8)',
    'text-halo-color': 'rgba(0, 0, 0, 0.9)',
    'text-halo-width': 2,
  },
};


// ── Component ───────────────────────────────────────────────

export const TemperatureOverlay = memo(function TemperatureOverlay() {
  const showOverlay = useTemperatureOverlayStore((s) => s.showOverlay);
  const thermalProfile = useTemperatureOverlayStore((s) => s.thermalProfile);
  const stations = useWeatherStore((s) => s.stations);
  const currentReadings = useWeatherStore((s) => s.currentReadings);
  const buoys = useBuoyStore((s) => s.buoys);
  const isRias = useSectorStore((s) => s.activeSector.id === 'rias');

  // ── Temperature circles GeoJSON (stations + buoy water temps) ──
  const circlesGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay) return EMPTY_FC;

    const features: GeoJSON.Feature[] = [];

    // Weather station air temps
    const temps = extractAllStationTemps(stations, currentReadings);
    for (const t of temps) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
        properties: {
          temperature: t.temperature,
          color: temperatureColor(t.temperature),
          altitude: t.altitude,
          name: t.name,
          label: `${t.temperature.toFixed(1)}°`,
          sublabel: `${t.name} · ${t.altitude}m`,
        },
      });
    }

    // Buoy water temps (Rías sector only)
    if (isRias) {
      for (const b of buoys) {
        if (b.waterTemp == null) continue;
        const coords = BUOY_COORDS_MAP.get(b.stationId);
        if (!coords) continue;
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [coords.lon, coords.lat] },
          properties: {
            temperature: b.waterTemp,
            color: waterTempColor(b.waterTemp),
            altitude: 0,
            name: b.stationName,
            label: `${b.waterTemp.toFixed(1)}°`,
            sublabel: `${b.stationName} · agua`,
          },
        });
      }
    }

    if (features.length === 0) return EMPTY_FC;

    return { type: 'FeatureCollection', features };
  }, [showOverlay, stations, currentReadings, buoys, isRias]);

  // Don't render any sources when completely off
  if (!showOverlay) return null;

  return (
    <Source id="temp-gradient-circles" type="geojson" data={circlesGeoJSON}>
      <Layer {...circleGlowLayer} />
      <Layer {...circleCoreLayer} />
      <Layer {...tempLabelLayer} />
      <Layer {...stationSubLabelLayer} />
    </Source>
  );
});
