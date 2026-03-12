/**
 * OpenSeaMap seamark overlay — nautical markers, buoys, lights, ports.
 *
 * Renders as transparent PNG tiles ON TOP of the base map.
 * tiles.openseamap.org — free, no auth, XYZ format.
 *
 * Only shown when showSeamarks toggle is active.
 * Best combined with Dark Matter or Positron base for contrast.
 */
import { memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useMapStyleStore } from '../../store/mapStyleStore';

export const SeamarksOverlay = memo(function SeamarksOverlay() {
  const showSeamarks = useMapStyleStore((s) => s.showSeamarks);

  if (!showSeamarks) return null;

  return (
    <Source
      id="openseamap"
      type="raster"
      tiles={['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png']}
      tileSize={256}
      attribution="&copy; OpenSeaMap contributors"
      maxzoom={18}
    >
      <Layer
        id="openseamap-tiles"
        type="raster"
        paint={{ 'raster-opacity': 0.9 }}
      />
    </Source>
  );
});
