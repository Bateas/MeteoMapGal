import { useMemo, memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import type { LayerProps } from 'react-map-gl/maplibre';
import type { ExpressionSpecification } from 'maplibre-gl';
import { useWeatherStore } from '../../store/weatherStore';
import { useTemperatureOverlayStore } from '../../store/temperatureOverlayStore';
import { useBuoyStore } from '../../store/buoyStore';
import { useSectorStore } from '../../store/sectorStore';
import { BUOY_COORDS_MAP } from '../../api/buoyClient';
import { temperatureColor } from '../../services/windUtils';
import { extractAllStationTemps } from '../../services/lapseRateService';
import { useMapInk, type MapInk } from '../../hooks/useMapInk';
import type { BuoyReading } from '../../api/buoyClient';

// ── Empty GeoJSON for stable reference when overlay is off ──
const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

// ── Layer styles ────────────────────────────────────────────

/** The water is one colour and a ring, the air a filled circle by temperature: it used to take zoom 11 and
 *  the small print to tell which was which, with two different colour scales on the same map. */
const WATER_RING = '#38bdf8';

const isWater: ExpressionSpecification = ['==', ['get', 'kind'], 'water'];
const isAir: ExpressionSpecification = ['==', ['get', 'kind'], 'air'];

/** Outer glow halo — large, blurred, very transparent. Air only: the water is the ring. */
const circleGlowLayer: LayerProps = {
  id: 'temp-circle-glow',
  type: 'circle',
  filter: isAir,
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
  filter: isAir,
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

/** The water: an empty ring of a fixed size, so it never reads as a temperature patch. */
const waterRingLayer: LayerProps = {
  id: 'temp-water-ring',
  type: 'circle',
  filter: isWater,
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 12, 11],
    'circle-color': 'transparent',
    'circle-stroke-width': 2.5,
    'circle-stroke-color': WATER_RING,
  },
};

/**
 * Temperature value label — positioned ABOVE the station marker so it
 * doesn't overlap with the marker icon or the map place name.
 *
 * Declutter behavior (2026-05-28):
 * - At zoom <10 (wide Rías view), labels are HIDDEN — the dots stay
 *   visible but ~80 numbers overlapping became unreadable.
 * - At zoom 10-12, MapLibre collision detection is ON
 *   (`text-allow-overlap: false`), so when two labels would overlap
 *   only one wins. User scrolls/zooms to see different ones.
 * - At zoom 12+, label size grows; eventually they have room and most
 *   end up visible (still no force-overlap so labels stay readable).
 */
const tempLabelLayer = (ink: MapInk): LayerProps => ({
  id: 'temp-label',
  type: 'symbol',
  layout: {
    'text-field': ['get', 'label'],
    'text-font': ['Noto Sans Bold'],
    'text-size': ['interpolate', ['linear'], ['zoom'], 8.5, 12, 12, 15, 15, 20],
    'text-allow-overlap': false,
    'text-ignore-placement': false,
    'text-padding': 5,
    'text-offset': [0, -1.8],
    'text-anchor': 'bottom',
    // Few buoys among many stations: on a collision the water keeps its label.
    'symbol-sort-key': ['case', isWater, 0, 1],
  },
  paint: {
    'text-color': ink.text,
    'text-halo-color': ink.halo,
    'text-halo-width': 2,
    'text-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 8.5, 1],
  },
});

/**
 * Station name + altitude sub-label — positioned BELOW the station marker.
 * Only from zoom 11, at a size that can be read.
 */
const stationSubLabelLayer = (ink: MapInk): LayerProps => ({
  id: 'temp-station-sublabel',
  type: 'symbol',
  layout: {
    'text-field': ['step', ['zoom'], '', 11, ['get', 'sublabel']],
    'text-font': ['Noto Sans Regular'],
    'text-size': ['interpolate', ['linear'], ['zoom'], 11, 12, 15, 13],
    'text-allow-overlap': true,
    'text-ignore-placement': true,
    'text-offset': [0, 2.2],
    'text-anchor': 'top',
  },
  paint: {
    'text-color': ink.text,
    'text-halo-color': ink.halo,
    'text-halo-width': 1.5,
  },
});

const degrees = (t: number) => `${t.toFixed(1).replace('.', ',')}°`;

/** One feature per air reading and per buoy with water temperature; `kind` says which it is. */
export function buildTemperatureFeatures(
  temps: { lat: number; lon: number; temperature: number; altitude: number; name: string }[],
  buoys: Pick<BuoyReading, 'stationId' | 'stationName' | 'waterTemp'>[],
): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = temps.map((t) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
    properties: {
      kind: 'air',
      temperature: t.temperature,
      color: temperatureColor(t.temperature),
      altitude: t.altitude,
      name: t.name,
      label: degrees(t.temperature),
      sublabel: `${t.name} · ${t.altitude} m`,
    },
  }));
  for (const b of buoys) {
    if (b.waterTemp == null) continue;
    const coords = BUOY_COORDS_MAP.get(b.stationId);
    if (!coords) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coords.lon, coords.lat] },
      properties: {
        kind: 'water',
        temperature: b.waterTemp,
        altitude: 0,
        name: b.stationName,
        label: `agua ${degrees(b.waterTemp)}`,
        sublabel: b.stationName,
      },
    });
  }
  return features;
}

// ── Component ───────────────────────────────────────────────

export const TemperatureOverlay = memo(function TemperatureOverlay() {
  const showOverlay = useTemperatureOverlayStore((s) => s.showOverlay);
  const stations = useWeatherStore((s) => s.stations);
  const currentReadings = useWeatherStore((s) => s.currentReadings);
  const buoys = useBuoyStore((s) => s.buoys);
  const isCoastal = useSectorStore((s) => s.activeSector.coastal);
  const ink = useMapInk();

  // ── Temperature circles GeoJSON (stations + buoy water temps) ──
  const circlesGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay) return EMPTY_FC;

    // Weather station air temps + buoy water temps (coastal sectors only)
    const features = buildTemperatureFeatures(
      extractAllStationTemps(stations, currentReadings),
      isCoastal ? buoys : [],
    );

    if (features.length === 0) return EMPTY_FC;

    return { type: 'FeatureCollection', features };
  }, [showOverlay, stations, currentReadings, buoys, isCoastal]);

  // Don't render any sources when completely off
  if (!showOverlay) return null;

  return (
    <Source id="temp-gradient-circles" type="geojson" data={circlesGeoJSON}>
      <Layer {...circleGlowLayer} />
      <Layer {...circleCoreLayer} />
      <Layer {...waterRingLayer} />
      <Layer {...tempLabelLayer(ink)} />
      <Layer {...stationSubLabelLayer(ink)} />
    </Source>
  );
});
