/**
 * IGN MDT Contour Lines overlay — 25m spacing from BTN25.
 * Source: Instituto Geográfico Nacional (ign.es), WMTS GoogleMapsCompatible.
 * Only shown when showIGNContours toggle is active.
 */
import { memo } from 'react';
import { useMapStyleStore } from '../../store/mapStyleStore';
import { RasterTileOverlay } from './RasterTileOverlay';

const IGN_CONTOURS_URL =
  'https://www.ign.es/wmts/mdt?service=WMTS&request=GetTile&version=1.0.0&format=image/png&layer=MDT.CurvasNivel&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}';

export const IGNContoursOverlay = memo(function IGNContoursOverlay() {
  const show = useMapStyleStore((s) => s.showIGNContours);
  return (
    <RasterTileOverlay
      visible={show}
      sourceId="ign-contours"
      layerId="ign-contours-tiles"
      tiles={[IGN_CONTOURS_URL]}
      minzoom={10}
      maxzoom={17}
      layerMinzoom={10}
      opacity={0.6}
      attribution="© IGN España — MDT"
    />
  );
});
