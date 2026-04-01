import { useMemo, memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import type { LayerProps } from 'react-map-gl/maplibre';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import { temperatureColor } from '../../services/windUtils';

// ── Empty GeoJSON ──────────────────────────────────────────
const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

// ── GPU Layer styles ───────────────────────────────────────

/** Outer ring — colored circle */
const outerRingLayer: LayerProps = {
  id: 'temp-only-outer',
  type: 'circle',
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 12, 6, 15, 10],
    'circle-color': ['get', 'color'],
    'circle-opacity': 0.6,
    'circle-stroke-width': 1,
    'circle-stroke-color': ['get', 'color'],
    'circle-stroke-opacity': 0.8,
  },
};

/** Inner dot — white center */
const innerDotLayer: LayerProps = {
  id: 'temp-only-inner',
  type: 'circle',
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 12, 2.5, 15, 4],
    'circle-color': '#ffffff',
    'circle-opacity': 0.7,
  },
};

/** Temperature label — tiny */
const tempLabelLayer: LayerProps = {
  id: 'temp-only-label',
  type: 'symbol',
  layout: {
    'text-field': ['get', 'label'],
    'text-font': ['Noto Sans Bold'],
    'text-size': ['interpolate', ['linear'], ['zoom'], 9, 0, 11, 8, 13, 10],
    'text-allow-overlap': true,
    'text-ignore-placement': true,
    'text-offset': [0, 1.2],
    'text-anchor': 'top',
  },
  paint: {
    'text-color': ['get', 'color'],
    'text-halo-color': 'rgba(0, 0, 0, 0.8)',
    'text-halo-width': 1.5,
    'text-opacity': 0.85,
  },
};

// ── Component ──────────────────────────────────────────────

interface TempOnlyOverlayProps {
  stations: NormalizedStation[];
  readings: Map<string, NormalizedReading>;
}

/**
 * GPU-accelerated temp-only markers. Replaces ~11 DOM Markers with 3 MapLibre
 * layers (outer circle + inner dot + label), all rendered on the GPU.
 * Zero JS overhead during pan/zoom.
 */
export const TempOnlyOverlay = memo(function TempOnlyOverlay({ stations, readings }: TempOnlyOverlayProps) {
  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];

    for (const station of stations) {
      if (!station.tempOnly) continue;
      const reading = readings.get(station.id);
      const temp = reading?.temperature ?? null;
      const color = temperatureColor(temp);

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [station.lon, station.lat],
        },
        properties: {
          color,
          label: temp !== null ? `${Math.round(temp)}°` : '',
          name: station.name,
        },
      });
    }

    return features.length > 0 ? { type: 'FeatureCollection', features } : EMPTY_FC;
  }, [stations, readings]);

  if (geojson.features.length === 0) return null;

  return (
    <Source id="temp-only-markers" type="geojson" data={geojson}>
      <Layer {...outerRingLayer} />
      <Layer {...innerDotLayer} />
      <Layer {...tempLabelLayer} />
    </Source>
  );
});

// Re-export for backward compatibility (single marker no longer used)
export const TempOnlyMarker = memo(function TempOnlyMarkerLegacy({}: {
  station: NormalizedStation;
  reading?: NormalizedReading;
}) {
  return null; // No-op — use TempOnlyOverlay instead
});
