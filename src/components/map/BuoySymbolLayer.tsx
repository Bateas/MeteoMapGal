/**
 * BuoySymbolLayer — GPU-accelerated buoy markers via MapLibre symbol layer.
 *
 * Replaces 13 DOM `<Marker>` components with a single GeoJSON source + circle/symbol layer.
 * Cyan marine theme. Shows wave height as text label.
 */
import { useMemo, useEffect, useCallback } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type { BuoyReading } from '../../types/buoy';
import { BUOY_COORDS_MAP } from '../../api/buoyClient';

interface BuoySymbolLayerProps {
  buoys: BuoyReading[];
  selectedBuoyId: number | null;
  onSelectBuoy: (id: number | null) => void;
}

/** Freshness color for buoy ring */
function buoyFreshness(timestamp?: Date | string | null): number {
  if (!timestamp) return 0.3;
  const t = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const age = (Date.now() - t.getTime()) / 60_000;
  return age < 60 ? 1.0 : age < 180 ? 0.7 : 0.4;
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

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [coords.lon, coords.lat] },
        properties: {
          id: buoy.stationId,
          name: buoy.stationName,
          waveLabel,
          waterTemp: buoy.waterTemp,
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
    const layerId = 'buoys-circles';

    map.on('click', layerId, handleClick);
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });

    return () => {
      map.off('click', layerId, handleClick);
      map.off('mouseenter', layerId, () => {});
      map.off('mouseleave', layerId, () => {});
    };
  }, [mapRef, handleClick]);

  const circleRadius: maplibregl.ExpressionSpecification = [
    'interpolate', ['linear'], ['zoom'],
    9, 5,
    10, 7,
    11, 9,
    12, 12,
  ];

  return (
    <Source id="buoys-geo" type="geojson" data={geojson}>
      {/* Main buoy circle — cyan marine */}
      <Layer
        id="buoys-circles"
        type="circle"
        paint={{
          'circle-radius': circleRadius,
          'circle-color': '#0e7490', // cyan-700
          'circle-stroke-color': '#06b6d4', // cyan-500
          'circle-stroke-width': 2,
          'circle-opacity': ['get', 'freshness'],
        }}
      />

      {/* Wave height label */}
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 10, 12, 18],
          'circle-color': 'transparent',
          'circle-stroke-color': '#22d3ee',
          'circle-stroke-width': 2.5,
        }}
      />
    </Source>
  );
}
