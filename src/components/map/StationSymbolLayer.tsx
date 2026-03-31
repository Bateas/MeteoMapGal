/**
 * StationSymbolLayer — GPU-accelerated station markers via MapLibre symbol layer.
 *
 * Replaces 90+ DOM `<Marker>` components with a single GeoJSON source + symbol layer.
 * Icons are rendered on the WebGL canvas — no DOM elements, no CSS hacks,
 * no visibility toggle during pan. 60fps guaranteed.
 *
 * Wind arrows are handled separately by WindFieldOverlay (already GPU).
 * This layer shows: colored circle (temperature) + station name label.
 */
import { useMemo, useEffect, useCallback } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import { temperatureColor, windSpeedColor } from '../../services/windUtils';

interface StationSymbolLayerProps {
  stations: NormalizedStation[];
  readings: Map<string, NormalizedReading>;
  selectedStationId: string | null;
  onSelectStation: (id: string | null) => void;
  zoomLevel: number;
}

/** Bin temperature into discrete color index for icon-color expression */
function tempBinColor(temp: number | null): string {
  return temperatureColor(temp);
}

/** Freshness in minutes */
function ageMins(timestamp?: Date | string | null): number {
  if (!timestamp) return 999;
  const t = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return (Date.now() - t.getTime()) / 60_000;
}

/** Register the station circle icon (SDF mode for dynamic coloring) */
export async function registerStationIcon(map: maplibregl.Map): Promise<void> {
  const id = 'station-circle';
  if (map.hasImage(id)) return;

  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;

  // White filled circle — SDF mode will recolor it
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Thin border for definition
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const img = await new Promise<HTMLImageElement>((resolve) => {
    const image = new Image(size, size);
    image.onload = () => resolve(image);
    image.src = canvas.toDataURL('image/png');
  });

  if (!map.hasImage(id)) {
    map.addImage(id, img, { sdf: true }); // SDF allows icon-color to recolor
  }
}

export function StationSymbolLayer({
  stations,
  readings,
  selectedStationId,
  onSelectStation,
  zoomLevel,
}: StationSymbolLayerProps) {
  const { current: mapRef } = useMap();

  // Build GeoJSON from stations + readings
  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];

    for (const station of stations) {
      if (station.tempOnly) continue;
      const reading = readings.get(station.id);
      const windMs = reading?.windSpeed ?? 0;
      const age = ageMins(reading?.timestamp);
      const isSelected = station.id === selectedStationId;

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [station.lon, station.lat] },
        properties: {
          id: station.id,
          name: station.name,
          source: station.source,
          windSpeed: windMs,
          temperature: reading?.temperature ?? null,
          tempColor: tempBinColor(reading?.temperature ?? null),
          windColor: windSpeedColor(reading?.windSpeed ?? null),
          freshness: age < 10 ? 1.0 : age < 30 ? 0.85 : age < 60 ? 0.6 : 0.35,
          isSelected: isSelected ? 1 : 0,
        },
      });
    }

    return { type: 'FeatureCollection', features };
  }, [stations, readings, selectedStationId]);

  // Click handler — map event instead of per-marker
  const handleClick = useCallback(
    (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const id = feature.properties?.id as string;
      onSelectStation(id === selectedStationId ? null : id);
    },
    [onSelectStation, selectedStationId],
  );

  // Register click + cursor handlers
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const layerId = 'stations-symbols';

    map.on('click', layerId, handleClick);
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });

    return () => {
      map.off('click', layerId, handleClick);
      map.off('mouseenter', layerId, () => {});
      map.off('mouseleave', layerId, () => {});
    };
  }, [mapRef, handleClick]);

  // Zoom-based size scaling (matches old marker behavior)
  const iconSize: maplibregl.ExpressionSpecification = [
    'interpolate', ['linear'], ['zoom'],
    9, 0.35,
    10, 0.5,
    11, 0.7,
    12, 0.9,
  ];

  // Zoom-based wind threshold filter (same as old WeatherMap filter)
  const filter: maplibregl.ExpressionSpecification = [
    'any',
    ['>=', ['zoom'], 12], // show all at zoom >= 12
    ['all', ['>=', ['zoom'], 11], ['>=', ['get', 'windSpeed'], 1.03]], // >= 2kt at zoom 11
    ['all', ['>=', ['zoom'], 10], ['>=', ['get', 'windSpeed'], 2.06]], // >= 4kt at zoom 10
    ['==', ['get', 'isSelected'], 1], // always show selected
  ];

  return (
    <Source id="stations-geo" type="geojson" data={geojson}>
      {/* Circle icon colored by temperature */}
      <Layer
        id="stations-symbols"
        type="symbol"
        filter={filter}
        layout={{
          'icon-image': 'station-circle',
          'icon-size': iconSize,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': ['step', ['zoom'], '', 11, ['get', 'name']],
          'text-size': 11,
          'text-offset': [0, 1.8],
          'text-anchor': 'top',
          'text-optional': true,
          'text-allow-overlap': false,
        }}
        paint={{
          'icon-color': ['get', 'tempColor'],
          'icon-opacity': ['get', 'freshness'],
          'text-color': '#cbd5e1', // slate-300
          'text-halo-color': '#0f172a', // slate-900
          'text-halo-width': 1.5,
        }}
      />

      {/* Selection ring — larger, glowing */}
      <Layer
        id="stations-selected-ring"
        type="circle"
        filter={['==', ['get', 'isSelected'], 1]}
        paint={{
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 8, 12, 16],
          'circle-color': 'transparent',
          'circle-stroke-color': '#60a5fa', // blue-400
          'circle-stroke-width': 2.5,
          'circle-opacity': 0.9,
        }}
      />
    </Source>
  );
}
