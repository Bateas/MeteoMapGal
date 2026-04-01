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
import { SOURCE_CONFIG } from '../../config/sourceConfig';

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

  const size = 36;
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

  // Subtle inner shadow for depth
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
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

      const srcMeta = SOURCE_CONFIG[station.source];
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [station.lon, station.lat] },
        properties: {
          id: station.id,
          name: station.name,
          source: station.source,
          sourceLabel: srcMeta?.label ?? '?',
          sourceColor: srcMeta?.color ?? '#64748b',
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

  // Register click + cursor handlers on both clickable layers
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const layers = ['stations-icons', 'stations-source-ring'];
    const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = ''; };

    for (const layerId of layers) {
      map.on('click', layerId, handleClick);
      map.on('mouseenter', layerId, enter);
      map.on('mouseleave', layerId, leave);
    }

    return () => {
      for (const layerId of layers) {
        map.off('click', layerId, handleClick);
        map.off('mouseenter', layerId, enter);
        map.off('mouseleave', layerId, leave);
      }
    };
  }, [mapRef, handleClick]);

  // Zoom-based size scaling — visible from zoom 8+
  const iconSize: maplibregl.ExpressionSpecification = [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25,
    9, 0.35,
    10, 0.5,
    11, 0.7,
    12, 0.9,
  ];

  // Relaxed filter — dashboard mode: show as much as possible
  // Only hide zero-wind at very low zoom; show everything at zoom >= 10
  const filter: maplibregl.ExpressionSpecification = [
    'any',
    ['>=', ['zoom'], 10],                                              // show ALL at zoom >= 10
    ['all', ['>=', ['zoom'], 9], ['>=', ['get', 'windSpeed'], 1.03]],  // >= 2kt at zoom 9
    ['all', ['>=', ['zoom'], 8], ['>=', ['get', 'windSpeed'], 2.06]],  // >= 4kt at zoom 8
    ['==', ['get', 'isSelected'], 1],                                  // always show selected
  ];

  return (
    <Source id="stations-geo" type="geojson" data={geojson}>
      {/* Source-colored ring — identifies data provider at a glance */}
      <Layer
        id="stations-source-ring"
        type="circle"
        filter={filter}
        paint={{
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 7, 10, 9, 11, 12, 12, 15],
          'circle-color': 'transparent',
          'circle-stroke-color': ['get', 'sourceColor'],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 12, 1.5],
          'circle-opacity': ['*', ['get', 'freshness'], 0.7],
        }}
      />

      {/* Circle icon colored by temperature + source label centered */}
      <Layer
        id="stations-icons"
        type="symbol"
        filter={filter}
        layout={{
          'icon-image': 'station-circle',
          'icon-size': iconSize,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          // Source label always visible (A, MG, MC, WU, NT, SX)
          'text-field': ['get', 'sourceLabel'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 7, 11, 9, 12, 11],
          'text-offset': [0, 0],
          'text-anchor': 'center',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        }}
        paint={{
          'icon-color': ['get', 'tempColor'],
          'icon-opacity': ['get', 'freshness'],
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.5)',
          'text-halo-width': 0.8,
        }}
      />

      {/* Station name below — only at zoom >= 11 */}
      <Layer
        id="stations-names"
        type="symbol"
        filter={filter}
        layout={{
          'text-field': ['step', ['zoom'], '', 11, ['get', 'name']],
          'text-size': 11,
          'text-offset': [0, 1.8],
          'text-anchor': 'top',
          'text-optional': true,
          'text-allow-overlap': false,
        }}
        paint={{
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 10, 12, 18],
          'circle-color': 'transparent',
          'circle-stroke-color': '#60a5fa', // blue-400
          'circle-stroke-width': 2.5,
          'circle-opacity': 0.9,
        }}
      />
    </Source>
  );
}
