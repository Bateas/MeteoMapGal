/**
 * WebcamSymbolLayer — GPU-accelerated webcam markers via MapLibre symbol layer.
 *
 * Triangle shape rotated by camera azimuth to show viewing direction.
 * Green theme (distinct from station circles and buoy diamonds).
 * Click opens WebcamPopup with live image.
 */
import { useMemo, useEffect, useCallback } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type { WebcamStation } from '../../config/webcams';

interface WebcamSymbolLayerProps {
  webcams: WebcamStation[];
  selectedWebcamId: string | null;
  onSelectWebcam: (id: string | null) => void;
}

/** Register the webcam triangle icon (SDF mode for recoloring) */
export async function registerWebcamIcon(map: maplibregl.Map): Promise<void> {
  const id = 'webcam-triangle';
  if (map.hasImage(id)) return;

  const size = 36;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const r = size / 2 - 3;

  // Triangle pointing UP (north) — rotated by azimuth via icon-rotate
  ctx.beginPath();
  ctx.moveTo(cx, 3);              // top vertex
  ctx.lineTo(cx + r, size - 4);   // bottom right
  ctx.lineTo(cx - r, size - 4);   // bottom left
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
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

export function WebcamSymbolLayer({
  webcams,
  selectedWebcamId,
  onSelectWebcam,
}: WebcamSymbolLayerProps) {
  const { current: mapRef } = useMap();

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];

    for (const cam of webcams) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [cam.lon, cam.lat] },
        properties: {
          id: cam.id,
          name: cam.name,
          azimuth: cam.azimuth,
          isSelected: cam.id === selectedWebcamId ? 1 : 0,
        },
      });
    }

    return { type: 'FeatureCollection', features };
  }, [webcams, selectedWebcamId]);

  // Click handler
  const handleClick = useCallback(
    (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const id = feature.properties?.id as string;
      onSelectWebcam(id === selectedWebcamId ? null : id);
    },
    [onSelectWebcam, selectedWebcamId],
  );

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const layerId = 'webcams-icons';

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
    8, 0.3,
    9, 0.4,
    10, 0.55,
    11, 0.7,
    12, 0.85,
  ];

  return (
    <Source id="webcams-geo" type="geojson" data={geojson}>
      {/* Triangle icon — rotated by camera azimuth, green tint */}
      <Layer
        id="webcams-icons"
        type="symbol"
        layout={{
          'icon-image': 'webcam-triangle',
          'icon-size': iconSize,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotate': ['get', 'azimuth'],
          'icon-rotation-alignment': 'map',
          // Camera name below at higher zoom
          'text-field': ['step', ['zoom'], '', 11, ['get', 'name']],
          'text-size': 10,
          'text-offset': [0, 1.6],
          'text-anchor': 'top',
          'text-optional': true,
          'text-allow-overlap': false,
        }}
        paint={{
          'icon-color': '#4ade80',  // green-400 — webcam theme
          'icon-opacity': 0.8,
          'text-color': '#86efac',  // green-300
          'text-halo-color': '#0f172a',
          'text-halo-width': 1.2,
        }}
      />

      {/* Selection ring */}
      <Layer
        id="webcams-selected-ring"
        type="circle"
        filter={['==', ['get', 'isSelected'], 1]}
        paint={{
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 10, 12, 16],
          'circle-color': 'transparent',
          'circle-stroke-color': '#4ade80',
          'circle-stroke-width': 2.5,
          'circle-opacity': 0.9,
        }}
      />
    </Source>
  );
}
