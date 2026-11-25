/**
 * IHM Electronic Navigational Chart overlay — official Spanish nautical charts.
 * Source: Instituto Hidrográfico de la Marina (ideihm.covam.es), WMS GetMap
 * consumed by MapLibre as raster tiles via {bbox-epsg-3857}.
 * Only shown when showNauticalChart toggle is active (coastal sectors).
 */
import { memo, useEffect, useState } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import { useMapStyleStore } from '../../store/mapStyleStore';
import { RasterTileOverlay } from './RasterTileOverlay';
import { useTileBreaker } from '../../hooks/useTileBreaker';

const IHM_WMS_URL =
  'https://ideihm.covam.es/encwms/wms?service=WMS&version=1.1.1&request=GetMap&layers=ENC&styles=&srs=EPSG:3857&format=image/png&transparent=true&width=256&height=256&bbox={bbox-epsg-3857}';

/**
 * Below this zoom it asks for no tiles: at 10, where the map opens, it was the dearest layer of all (185
 * tiles straight from each visitor to the IHM) for a chart too small to read a shoal on.
 */
export const CHART_MIN_ZOOM = 11;

export const NauticalChartOverlay = memo(function NauticalChartOverlay() {
  const showNauticalChart = useMapStyleStore((s) => s.showNauticalChart);
  // Straight from each visitor to the IHM, whose tide server has been down
  // for days: if its chart tiles start failing too, stop asking for a while.
  const tilesBlocked = useTileBreaker('ihm-enc');

  const { current: mapRef } = useMap();
  const [tooFar, setTooFar] = useState(false);
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !showNauticalChart) return;
    const onZoom = () => setTooFar(map.getZoom() < CHART_MIN_ZOOM);
    onZoom();
    map.on('zoom', onZoom);
    return () => { map.off('zoom', onZoom); };
  }, [mapRef, showNauticalChart]);

  return (
    <>
      <RasterTileOverlay
        visible={showNauticalChart && !tilesBlocked}
        sourceId="ihm-enc"
        layerId="ihm-enc-tiles"
        tiles={[IHM_WMS_URL]}
        minzoom={CHART_MIN_ZOOM}
        maxzoom={17}
        layerMinzoom={CHART_MIN_ZOOM}
        opacity={0.75}
        attribution="© IHM — Instituto Hidrográfico de la Marina"
      />
      {/* The switch stays on in both cases, so the map says why there is no chart on it */}
      {showNauticalChart && tilesBlocked && (
        <div className="g-theme gc-hint gc-mapnote" role="status">
          Carta náutica sin servicio: el IHM no responde. Se vuelve a probar en unos minutos.
        </div>
      )}
      {showNauticalChart && !tilesBlocked && tooFar && (
        <div className="g-theme gc-hint gc-mapnote" role="status">
          Carta náutica: acércate para verla.
        </div>
      )}
    </>
  );
});
