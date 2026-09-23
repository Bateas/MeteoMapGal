/**
 * IHM Electronic Navigational Chart overlay — official Spanish nautical charts.
 * Source: Instituto Hidrográfico de la Marina (ideihm.covam.es), WMS GetMap
 * consumed by MapLibre as raster tiles via {bbox-epsg-3857}.
 * Only shown when showNauticalChart toggle is active (coastal sectors).
 */
import { memo } from 'react';
import { useMapStyleStore } from '../../store/mapStyleStore';
import { RasterTileOverlay } from './RasterTileOverlay';
import { useTileBreaker } from '../../hooks/useTileBreaker';

const IHM_WMS_URL =
  'https://ideihm.covam.es/encwms/wms?service=WMS&version=1.1.1&request=GetMap&layers=ENC&styles=&srs=EPSG:3857&format=image/png&transparent=true&width=256&height=256&bbox={bbox-epsg-3857}';

export const NauticalChartOverlay = memo(function NauticalChartOverlay() {
  const showNauticalChart = useMapStyleStore((s) => s.showNauticalChart);
  // Straight from each visitor to the IHM, whose tide server has been down
  // for days: if its chart tiles start failing too, stop asking for a while.
  const tilesBlocked = useTileBreaker('ihm-enc');
  return (
    <RasterTileOverlay
      visible={showNauticalChart && !tilesBlocked}
      sourceId="ihm-enc"
      layerId="ihm-enc-tiles"
      tiles={[IHM_WMS_URL]}
      minzoom={9}
      maxzoom={17}
      layerMinzoom={9}
      opacity={0.75}
      attribution="© IHM — Instituto Hidrográfico de la Marina"
    />
  );
});
