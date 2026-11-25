/**
 * BuoySymbolLayer — GPU-accelerated buoy markers via MapLibre symbol layer.
 *
 * Diamond (rotated square) shape to visually distinguish from station circles.
 * Cyan marine theme. Shows wave height as text label.
 */
import { useMemo, useEffect, useCallback } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import { BUOY_COORDS_MAP, type BuoyReading } from '../../api/buoyClient';
import { waterTempColor, silentLabel, labelSideAwayFromSpots } from '../../services/buoyUtils';
import { useMapInk } from '../../hooks/useMapInk';
import { useSectorStore } from '../../store/sectorStore';
import { getSpotsForSector } from '../../config/spots';

/** Under this a wave figure on the map says nothing, and it is what the tide gauges report. */
const MIN_WAVE_LABEL_M = 0.3;

/**
 * In the map's credits while the buoys are drawn. Puertos del Estado asks for its
 * name and the address of its portal wherever its data are used (1-oct-2026).
 * Short, because the credits line shares the bottom edge with the toolbar: here
 * the name links to the portal; the popup, the panel and the legal page print
 * the address in full. Constant: MapLibre reads it when the source is created.
 */
const BUOY_ATTRIBUTION =
  'Boyas: <a href="https://portus.puertos.es/" target="_blank" rel="noopener noreferrer">Puertos del Estado</a> y Xunta';

interface BuoySymbolLayerProps {
  buoys: BuoyReading[];
  selectedBuoyId: number | null;
  onSelectBuoy: (id: number | null) => void;
}

const SILENT_GREY = '#8b929c';

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
  const ink = useMapInk();
  const { current: mapRef } = useMap();
  const sectorId = useSectorStore((s) => s.activeSector.id);

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];
    const spots = getSpotsForSector(sectorId).map((s) => ({ lat: s.center[1], lon: s.center[0] }));

    for (const buoy of buoys) {
      const coords = BUOY_COORDS_MAP.get(buoy.stationId);
      if (!coords) continue;

      // Only a real sea. The tide gauges report a few centimetres: beside a spot, «0.0m» read as a measured flat.
      // A buoy silent for hours is grey with «sin dato desde» (18-nov), not a faint copy of its old colour.
      const silent = silentLabel(buoy.timestamp);
      const waveLabel = silent
        ?? (buoy.waveHeight != null && buoy.waveHeight >= MIN_WAVE_LABEL_M ? `${buoy.waveHeight.toFixed(1).replace('.', ',')} m` : '');
      const isSelected = buoy.stationId === selectedBuoyId;
      // Water scale, the one the buoy popup uses: the air scale painted 16 °C water lime here and green there.
      const tempColor = silent ? SILENT_GREY : waterTempColor(buoy.waterTemp ?? null);

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [coords.lon, coords.lat] },
        properties: {
          id: buoy.stationId,
          name: buoy.stationName,
          waveLabel,
          // The long «sin dato desde» goes to the side with no spot marker on it (symbols draw under markers).
          labelSide: silent ? labelSideAwayFromSpots(coords, spots) : 'above',
          waterTemp: buoy.waterTemp,
          tempColor,
          freshness: silent ? 0.8 : buoyFreshness(buoy.timestamp),
          isSelected: isSelected ? 1 : 0,
        },
      });
    }

    return { type: 'FeatureCollection', features };
  }, [buoys, selectedBuoyId, sectorId]);

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

    // Named handlers so cleanup removes the SAME functions: `map.off` with a
    // fresh `() => {}` matched nothing, so every re-run (each buoy selection)
    // left two more listeners behind — and each one queries the rendered
    // features on EVERY mouse move.
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };
    map.on('click', layerId, handleClick);
    map.on('mouseenter', layerId, onEnter);
    map.on('mouseleave', layerId, onLeave);

    return () => {
      map.off('click', layerId, handleClick);
      map.off('mouseenter', layerId, onEnter);
      map.off('mouseleave', layerId, onLeave);
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
    <Source id="buoys-geo" type="geojson" data={geojson} attribution={BUOY_ATTRIBUTION}>
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
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 7, 11, 9, 12, 11],
          'text-offset': [0, 0],
          'text-anchor': 'center',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        }}
        paint={{
          'icon-color': ['get', 'tempColor'],
          'icon-opacity': ['*', ['get', 'freshness'], 0.75], // slightly transparent — less visual weight vs spots
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
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
          'text-offset': ['match', ['get', 'labelSide'], 'left', ['literal', [-1.5, 0]], 'right', ['literal', [1.5, 0]], ['literal', [0, -2]]],
          'text-anchor': ['match', ['get', 'labelSide'], 'left', 'right', 'right', 'left', 'bottom'],
          'text-justify': 'auto',
          'text-allow-overlap': true,
        }}
        paint={{
          'text-color': ink.text,
          'text-halo-color': ink.halo,
          'text-halo-width': 1.5,
        }}
      />

      {/* Name label below */}
      <Layer
        id="buoys-names"
        type="symbol"
        layout={{
          'text-field': ['step', ['zoom'], '', 11, ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'text-offset': [0, 1.8],
          'text-anchor': 'top',
          'text-optional': true,
          'text-allow-overlap': false,
        }}
        paint={{
          'text-color': ink.text,
          'text-halo-color': ink.halo,
          'text-halo-width': 1.5,
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
