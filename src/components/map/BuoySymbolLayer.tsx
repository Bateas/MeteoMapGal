/**
 * BuoySymbolLayer — GPU-accelerated buoy markers via MapLibre symbol layer.
 *
 * Diamond (rotated square) shape to visually distinguish from station circles.
 * Cyan marine theme. Shows wave height as text label.
 */
import { useMemo, useEffect, useCallback } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type { BuoyReading } from '../../types/buoy';
import { BUOY_COORDS_MAP } from '../../api/buoyClient';
import { temperatureColor } from '../../services/windUtils';

interface BuoySymbolLayerProps {
  buoys: BuoyReading[];
  selectedBuoyId: number | null;
  onSelectBuoy: (id: number | null) => void;
}

/** Freshness opacity for buoy — more aggressive fade for stale data */
function buoyFreshness(timestamp?: Date | string | null): number {
  if (!timestamp) return 0.2;
  const t = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const age = (Date.now() - t.getTime()) / 60_000;
  return age < 45 ? 1.0 : age < 90 ? 0.6 : age < 180 ? 0.35 : 0.2;
}

/** Register the buoy diamond icon (SDF mode for dynamic coloring) */
export async function registerBuoyIcon(map: maplibregl.Map): Promise<void> {
  const id = 'buoy-diamond';
  if (map.hasImage(id)) return;

  const size = 36;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 3;

  // Diamond shape (rotated square) — thick visible border
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);      // top
  ctx.lineTo(cx + r, cy);      // right
  ctx.lineTo(cx, cy + r);      // bottom
  ctx.lineTo(cx - r, cy);      // left
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  // Strong white border so SDF recolor creates visible edge
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const img = await new Promise<HTMLImageElement>((resolve) => {
    const image = new Image(size, size);
    image.onload = () => resolve(image);
    image.src = canvas.toDataURL('image/png');
  });

  if (!map.hasImage(id)) {
    map.addImage(id, img, { sdf: true });
  }
}

export function BuoySymbolLayer({
  buoys,
  selectedBuoyId,
  onSelectBuoy,
}: BuoySymbolLayerProps) {
  const { current: mapRef } = useMap();

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];

    for (const buoy of buoys) {
      const coords = BUOY_COORDS_MAP.get(buoy.stationId);
      if (!coords) continue;

      const waveLabel = buoy.waveHeight != null ? `${buoy.waveHeight.toFixed(1)}m` : '';
      const isSelected = buoy.stationId === selectedBuoyId;
      const tempColor = temperatureColor(buoy.waterTemp ?? null);

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [coords.lon, coords.lat] },
        properties: {
          id: buoy.stationId,
          name: buoy.stationName,
          waveLabel,
          waterTemp: buoy.waterTemp,
          tempColor,
          freshness: buoyFreshness(buoy.timestamp),
          isSelected: isSelected ? 1 : 0,
        },
      });
    }

    return { type: 'FeatureCollection', features };
  }, [buoys, selectedBuoyId]);

  // Click handler
  const handleClick = useCallback(
    (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const id = feature.properties?.id as number;
      onSelectBuoy(id === selectedBuoyId ? null : id);
    },
    [onSelectBuoy, selectedBuoyId],
  );

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const layerId = 'buoys-icons';

    map.on('click', layerId, handleClick);
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });

    return () => {
      map.off('click', layerId, handleClick);
      map.off('mouseenter', layerId, () => {});
      map.off('mouseleave', layerId, () => {});
    };
  }, [mapRef, handleClick]);

  const iconSize: maplibregl.ExpressionSpecification = [
    'interpolate', ['linear'], ['zoom'],
    9, 0.4,
    10, 0.55,
    11, 0.75,
    12, 0.95,
  ];

  return (
    <Source id="buoys-geo" type="geojson" data={geojson}>
      {/* Diamond icon — colored by water temperature, no outer ring */}
      <Layer
        id="buoys-icons"
        type="symbol"
        layout={{
          'icon-image': 'buoy-diamond',
          'icon-size': iconSize,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          // "B" label centered on diamond
          'text-field': 'B',
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

      {/* Wave height label above */}
      <Layer
        id="buoys-labels"
        type="symbol"
        layout={{
          'text-field': ['step', ['zoom'], '', 10, ['get', 'waveLabel']],
          'text-size': 11,
          'text-offset': [0, -2],
          'text-anchor': 'bottom',
          'text-allow-overlap': true,
        }}
        paint={{
          'text-color': '#22d3ee', // cyan-400
          'text-halo-color': '#0f172a',
          'text-halo-width': 1.5,
        }}
      />

      {/* Name label below */}
      <Layer
        id="buoys-names"
        type="symbol"
        layout={{
          'text-field': ['step', ['zoom'], '', 11, ['get', 'name']],
          'text-size': 10,
          'text-offset': [0, 1.8],
          'text-anchor': 'top',
          'text-optional': true,
          'text-allow-overlap': false,
        }}
        paint={{
          'text-color': '#67e8f9', // cyan-300
          'text-halo-color': '#0f172a',
          'text-halo-width': 1,
        }}
      />

      {/* Selection ring */}
      <Layer
        id="buoys-selected-ring"
        type="circle"
        filter={['==', ['get', 'isSelected'], 1]}
        paint={{
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 12, 12, 20],
          'circle-color': 'transparent',
          'circle-stroke-color': '#22d3ee',
          'circle-stroke-width': 2.5,
        }}
      />
    </Source>
  );
}
