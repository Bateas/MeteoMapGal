import { Source, Layer } from 'react-map-gl/maplibre';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';

/**
 * EMODnet Bathymetry tile overlay — shows seabed depth contours.
 * Direct XYZ tiles, no proxy needed, no auth.
 * Only visible in Rías Baixas sector (ocean context).
 */
export function BathymetryOverlay() {
  const visible = useUIStore((s) => s.bathymetryVisible);
  const sectorId = useSectorStore((s) => s.activeSector.id);

  if (!visible || sectorId !== 'rias') return null;

  return (
    <Source
      id="emodnet-bathymetry"
      type="raster"
      tiles={['https://tiles.emodnet-bathymetry.eu/v12/mean_atlas_land/web_mercator/{z}/{x}/{y}.png']}
      tileSize={256}
      minzoom={8}
      maxzoom={14}
      attribution="&copy; EMODnet Bathymetry"
    >
      <Layer
        id="bathymetry-layer"
        type="raster"
        minzoom={8}
        paint={{
          'raster-opacity': 0.55,
          'raster-fade-duration': 300,
        }}
      />
    </Source>
  );
}
