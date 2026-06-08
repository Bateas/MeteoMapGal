/**
 * EMODnet Bathymetry overlay — seabed depth contours. Direct XYZ tiles, no auth.
 * Only visible in coastal sectors (ocean context).
 */
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { isCoastalSector } from '../../config/sectors';
import { RasterTileOverlay } from './RasterTileOverlay';

export function BathymetryOverlay() {
  const visible = useUIStore((s) => s.bathymetryVisible);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  return (
    <RasterTileOverlay
      visible={visible && isCoastalSector(sectorId)}
      sourceId="emodnet-bathymetry"
      layerId="bathymetry-layer"
      tiles={['https://tiles.emodnet-bathymetry.eu/v12/mean_atlas_land/web_mercator/{z}/{x}/{y}.png']}
      minzoom={8}
      maxzoom={14}
      layerMinzoom={8}
      opacity={0.55}
      fadeDuration={300}
      attribution="© EMODnet Bathymetry"
    />
  );
}
