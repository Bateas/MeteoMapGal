/**
 * IGN PNOA Orthophoto overlay — aerial imagery at 25cm resolution.
 *
 * Source: Instituto Geográfico Nacional (ign.es)
 * Uses WMTS cached endpoint with GoogleMapsCompatible tilematrixset.
 *
 * Shows real aerial photography — useful for identifying terrain,
 * buildings, and water bodies around stations.
 *
 * Only shown when showIGNOrtho toggle is active.
 */
import { memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useMapStyleStore } from '../../store/mapStyleStore';

/** IGN PNOA orthophoto via WMTS — converted to XYZ-compatible URL */
const IGN_ORTHO_URL =
  'https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&format=image/jpeg&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}';

export const IGNOrthoOverlay = memo(function IGNOrthoOverlay() {
  const show = useMapStyleStore((s) => s.showIGNOrtho);

  if (!show) return null;

  return (
    <Source
      id="ign-ortho"
      type="raster"
      tiles={[IGN_ORTHO_URL]}
      tileSize={256}
      attribution="&copy; IGN España — PNOA"
      minzoom={8}
      maxzoom={19}
    >
      <Layer
        id="ign-ortho-tiles"
        type="raster"
        minzoom={8}
        paint={{ 'raster-opacity': 0.85 }}
      />
    </Source>
  );
});
