/**
 * IGN MDT Contour Lines overlay — 25m spacing from BTN25.
 *
 * Source: Instituto Geográfico Nacional (ign.es)
 * Uses WMTS cached endpoint with GoogleMapsCompatible tilematrixset.
 *
 * Shows altitude contour lines useful for understanding
 * altitude-dependent thermal behavior around the reservoir.
 *
 * Only shown when showIGNContours toggle is active.
 */
import { memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useMapStyleStore } from '../../store/mapStyleStore';

/** IGN MDT contour lines via WMTS — converted to XYZ-compatible URL */
const IGN_CONTOURS_URL =
  'https://www.ign.es/wmts/mdt?service=WMTS&request=GetTile&version=1.0.0&format=image/png&layer=MDT.CurvasNivel&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}';

export const IGNContoursOverlay = memo(function IGNContoursOverlay() {
  const show = useMapStyleStore((s) => s.showIGNContours);

  if (!show) return null;

  return (
    <Source
      id="ign-contours"
      type="raster"
      tiles={[IGN_CONTOURS_URL]}
      tileSize={256}
      attribution="&copy; IGN España — MDT"
      minzoom={10}
      maxzoom={17}
    >
      <Layer
        id="ign-contours-tiles"
        type="raster"
        minzoom={10}
        paint={{ 'raster-opacity': 0.6 }}
      />
    </Source>
  );
});
