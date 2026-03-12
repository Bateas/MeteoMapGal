/**
 * IHM Electronic Navigational Chart overlay — official Spanish nautical charts.
 *
 * Source: Instituto Hidrográfico de la Marina (ideihm.covam.es)
 * Uses WMTS cached endpoint for performance.
 *
 * Shows navigational features: depth contours, channels, anchorages,
 * restricted areas, traffic separation schemes.
 *
 * Only shown when showNauticalChart toggle is active.
 */
import { memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useMapStyleStore } from '../../store/mapStyleStore';

/** IHM ENC via WMS — MapLibre consumes WMS as raster tiles with {bbox-epsg-3857} */
const IHM_WMS_URL =
  'https://ideihm.covam.es/encwms/wms?service=WMS&version=1.1.1&request=GetMap&layers=ENC&styles=&srs=EPSG:3857&format=image/png&transparent=true&width=256&height=256&bbox={bbox-epsg-3857}';

export const NauticalChartOverlay = memo(function NauticalChartOverlay() {
  const showNauticalChart = useMapStyleStore((s) => s.showNauticalChart);

  if (!showNauticalChart) return null;

  return (
    <Source
      id="ihm-enc"
      type="raster"
      tiles={[IHM_WMS_URL]}
      tileSize={256}
      attribution="&copy; IHM — Instituto Hidrográfico de la Marina"
      maxzoom={17}
    >
      <Layer
        id="ihm-enc-tiles"
        type="raster"
        paint={{ 'raster-opacity': 0.75 }}
      />
    </Source>
  );
});
