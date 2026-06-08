/**
 * OpenSeaMap seamark overlay — nautical markers, buoys, lights, ports.
 * Transparent PNG tiles (tiles.openseamap.org, free, no auth) on top of the
 * base map. Only shown when showSeamarks toggle is active (coastal sectors).
 */
import { memo } from 'react';
import { useMapStyleStore } from '../../store/mapStyleStore';
import { RasterTileOverlay } from './RasterTileOverlay';

export const SeamarksOverlay = memo(function SeamarksOverlay() {
  const showSeamarks = useMapStyleStore((s) => s.showSeamarks);
  return (
    <RasterTileOverlay
      visible={showSeamarks}
      sourceId="openseamap"
      layerId="openseamap-tiles"
      tiles={['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png']}
      minzoom={8}
      maxzoom={18}
      layerMinzoom={8}
      opacity={0.9}
      attribution="© OpenSeaMap contributors"
    />
  );
});
