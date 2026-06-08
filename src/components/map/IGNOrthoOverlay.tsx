/**
 * IGN PNOA Orthophoto overlay — aerial imagery at 25cm resolution.
 * Source: Instituto Geográfico Nacional (ign.es), WMTS GoogleMapsCompatible.
 * Only shown when showIGNOrtho toggle is active.
 */
import { memo } from 'react';
import { useMapStyleStore } from '../../store/mapStyleStore';
import { RasterTileOverlay } from './RasterTileOverlay';

const IGN_ORTHO_URL =
  'https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&format=image/jpeg&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}';

export const IGNOrthoOverlay = memo(function IGNOrthoOverlay() {
  const show = useMapStyleStore((s) => s.showIGNOrtho);
  return (
    <RasterTileOverlay
      visible={show}
      sourceId="ign-ortho"
      layerId="ign-ortho-tiles"
      tiles={[IGN_ORTHO_URL]}
      minzoom={8}
      maxzoom={19}
      layerMinzoom={8}
      opacity={0.85}
      attribution="© IGN España — PNOA"
    />
  );
});
