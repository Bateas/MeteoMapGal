/**
 * IGN MDT Hillshade overlay — pre-rendered terrain relief shading.
 *
 * Source: Instituto Geográfico Nacional (ign.es)
 * Uses WMTS cached endpoint with GoogleMapsCompatible tilematrixset.
 *
 * Shows terrain relief with shadows and highlights — excellent for
 * understanding valley/ridge terrain that drives thermal winds.
 *
 * Only shown when showIGNHillshade toggle is active.
 */
import { memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useMapStyleStore } from '../../store/mapStyleStore';

/** IGN MDT hillshade via WMTS — converted to XYZ-compatible URL */
const IGN_HILLSHADE_URL =
  'https://www.ign.es/wmts/mdt?service=WMTS&request=GetTile&version=1.0.0&format=image/jpeg&layer=MDT.Relieve&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}';

export const IGNHillshadeOverlay = memo(function IGNHillshadeOverlay() {
  const show = useMapStyleStore((s) => s.showIGNHillshade);

  if (!show) return null;

  return (
    <Source
      id="ign-hillshade"
      type="raster"
      tiles={[IGN_HILLSHADE_URL]}
      tileSize={256}
      attribution="&copy; IGN España — MDT"
      minzoom={8}
      maxzoom={17}
    >
      <Layer
        id="ign-hillshade-tiles"
        type="raster"
        minzoom={8}
        paint={{ 'raster-opacity': 0.5 }}
      />
    </Source>
  );
});
