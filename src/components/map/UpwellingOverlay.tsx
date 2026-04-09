/**
 * Coastal Definition Overlay — EMODnet bathymetry + coastline WMS.
 *
 * Two professional data layers from EMODnet:
 *   1. Bathymetry tiles — subtle water fill (depth-colored, accurate coast)
 *   2. Coastline WMS — satellite-derived MSL coastline edge (crisp vector line)
 *
 * Toggle: "Costa" in Capas marinas (Rías sector only).
 * Best combined with Dark Matter base map.
 *
 * No auth needed — EMODnet is public EU marine data infrastructure.
 */
import { memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useSectorStore } from '../../store/sectorStore';
import { useMapStyleStore } from '../../store/mapStyleStore';

// EMODnet Bathymetry v12 — XYZ tiles (fast, pre-rendered)
const BATHY_TILES = [
  'https://tiles.emodnet-bathymetry.eu/v12/mean_atlas_land/web_mercator/{z}/{x}/{y}.png',
];

// EMODnet Coastline WMS — satellite-derived Mean Sea Level coastline
const COASTLINE_WMS = [
  'https://ows.emodnet-bathymetry.eu/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
  + '&LAYERS=coastlines&STYLES=coastline_msl'
  + '&CRS=EPSG:3857&BBOX={bbox-epsg-3857}'
  + '&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=true',
];

function CoastalOverlayInner() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const show = useMapStyleStore((s) => s.showUpwelling);

  if (sectorId !== 'rias' || !show) return null;

  return (
    <>
      {/* Water fill — bathymetry at low opacity, desaturated */}
      <Source
        id="coastal-fill"
        type="raster"
        tiles={BATHY_TILES}
        tileSize={256}
        minzoom={8}
        maxzoom={14}
        attribution="&copy; EMODnet Bathymetry"
      >
        <Layer
          id="coastal-fill-layer"
          type="raster"
          minzoom={8}
          paint={{
            'raster-opacity': 0.12,
            'raster-saturation': -0.5,
            'raster-brightness-max': 0.5,
            'raster-contrast': 0.2,
            'raster-fade-duration': 300,
          }}
        />
      </Source>

      {/* Coastline edge — EMODnet satellite MSL coastline */}
      <Source
        id="coastal-line"
        type="raster"
        tiles={COASTLINE_WMS}
        tileSize={512}
        minzoom={8}
        maxzoom={14}
      >
        <Layer
          id="coastal-line-layer"
          type="raster"
          minzoom={8}
          paint={{
            'raster-opacity': 0.7,
            'raster-fade-duration': 500,
          }}
        />
      </Source>
    </>
  );
}

export const UpwellingOverlay = memo(CoastalOverlayInner);
