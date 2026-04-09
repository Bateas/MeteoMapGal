/**
 * SWAN Wave Overlay — MeteoGalicia nearshore wave model (#56 v4).
 *
 * Shows REAL wave propagation inside the Rías from CESGA THREDDS WMS.
 * SWAN calculates: island shadows, channel narrowing, refraction,
 * depth-induced breaking, wind-wave generation.
 *
 * Layer `hs` = significant wave height (Hm0).
 * Resolution: ~250m grid, 96h forecast hourly. No auth needed.
 *
 * Toggle: "Oleaje SWAN" in Capas marinas (Rías only).
 * Auto-activates when buoy waveHeight ≥ 0.5m.
 */
import { memo, useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useSectorStore } from '../../store/sectorStore';
import { useMapStyleStore } from '../../store/mapStyleStore';
import { useBuoyStore } from '../../store/buoyStore';

// SWAN WMS via Vite proxy (CESGA THREDDS has no CORS headers)
const SWAN_TILE_URL =
  '/swan-api/thredds/wms/SWAN/agg/SWAN_agg_best.ncd'
  + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap'
  + '&LAYERS=hs'
  + '&SRS=EPSG:3857'
  + '&BBOX={bbox-epsg-3857}'
  + '&WIDTH=256&HEIGHT=256'
  + '&FORMAT=image/png'
  + '&TRANSPARENT=true'
  + '&COLORSCALERANGE=0,3';

const AUTO_WAVE_THRESHOLD = 0.5;

function SwanWaveOverlayInner() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const showSwan = useMapStyleStore((s) => s.showUpwelling);
  const buoys = useBuoyStore((s) => s.buoys);

  const maxWaveHeight = useMemo(() => {
    let max = 0;
    for (const b of buoys) {
      if (b.waveHeight != null && b.waveHeight > max) max = b.waveHeight;
    }
    return max;
  }, [buoys]);

  const isActive = sectorId === 'rias' && (showSwan || maxWaveHeight >= AUTO_WAVE_THRESHOLD);

  if (!isActive) return null;

  return (
    <Source
      id="swan-wave"
      type="raster"
      tiles={[SWAN_TILE_URL]}
      tileSize={256}
      minzoom={8}
      maxzoom={13}
      attribution="&copy; MeteoGalicia SWAN (CESGA)"
    >
      <Layer
        id="swan-wave-layer"
        type="raster"
        minzoom={8}
        paint={{
          'raster-opacity': 0.6,
          'raster-fade-duration': 300,
        }}
      />
    </Source>
  );
}

export const SwanWaveOverlay = memo(SwanWaveOverlayInner);
