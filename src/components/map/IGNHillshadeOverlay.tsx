/**
 * IGN MDT Hillshade overlay — pre-rendered terrain relief shading.
 * Source: Instituto Geográfico Nacional (ign.es), WMTS GoogleMapsCompatible.
 * Only shown when showIGNHillshade toggle is active.
 */
import { memo } from 'react';
import { useMapStyleStore } from '../../store/mapStyleStore';
import { RasterTileOverlay } from './RasterTileOverlay';

const IGN_HILLSHADE_URL =
  'https://www.ign.es/wmts/mdt?service=WMTS&request=GetTile&version=1.0.0&format=image/jpeg&layer=MDT.Relieve&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}';

export const IGNHillshadeOverlay = memo(function IGNHillshadeOverlay() {
  const show = useMapStyleStore((s) => s.showIGNHillshade);
  return (
    <RasterTileOverlay
      visible={show}
      sourceId="ign-hillshade"
      layerId="ign-hillshade-tiles"
      tiles={[IGN_HILLSHADE_URL]}
      minzoom={8}
      maxzoom={17}
      layerMinzoom={8}
      opacity={0.5}
      attribution="© IGN España — MDT"
    />
  );
});
