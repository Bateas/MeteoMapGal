/**
 * RasterTileOverlay — shared raster-tile Source+Layer skeleton.
 *
 * Consolidates 7 near-identical overlays (IGN ortho/hillshade/contours,
 * EMODnet bathymetry, OpenSeaMap seamarks, IHM nautical chart, CMEMS SST)
 * that differed only in tiles / opacity / zoom / attribution / visibility gate.
 * Each overlay is now a thin wrapper that computes `visible` (its toggle plus
 * any sector gate) and renders this presentational component.
 */
import { memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';

export interface RasterTileOverlayProps {
  /** Computed visibility (toggle + any sector gate). When false, renders nothing. */
  visible: boolean;
  sourceId: string;
  layerId: string;
  tiles: string[];
  /** raster-opacity (0–1). */
  opacity: number;
  tileSize?: number;
  /** Source minzoom (omit to leave unset). */
  minzoom?: number;
  /** Source maxzoom (omit to leave unset). */
  maxzoom?: number;
  /** Layer minzoom (omit to leave unset). */
  layerMinzoom?: number;
  /** raster-fade-duration in ms (omit to use MapLibre default). */
  fadeDuration?: number;
  attribution?: string;
}

export const RasterTileOverlay = memo(function RasterTileOverlay({
  visible,
  sourceId,
  layerId,
  tiles,
  opacity,
  tileSize = 256,
  minzoom,
  maxzoom,
  layerMinzoom,
  fadeDuration,
  attribution,
}: RasterTileOverlayProps) {
  if (!visible) return null;

  const paint = fadeDuration != null
    ? { 'raster-opacity': opacity, 'raster-fade-duration': fadeDuration }
    : { 'raster-opacity': opacity };

  return (
    <Source
      id={sourceId}
      type="raster"
      tiles={tiles}
      tileSize={tileSize}
      minzoom={minzoom}
      maxzoom={maxzoom}
      attribution={attribution}
    >
      <Layer id={layerId} type="raster" minzoom={layerMinzoom} paint={paint} />
    </Source>
  );
});
