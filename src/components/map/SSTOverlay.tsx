import { Source, Layer } from 'react-map-gl/maplibre';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';

/**
 * Copernicus Marine (CMEMS) Sea Surface Temperature overlay.
 *
 * Product: SST_ATL_SST_L4_NRT_OBSERVATIONS_010_025 (Atlantic IBI region)
 * Layer: analysed_sst — daily L4 gap-free SST from IFREMER
 * Resolution: 0.02° (~2 km)
 * Coverage: 9°–62°N, -21°–13°E (includes Galician coast)
 * Style: cmap:thermal (blue-to-red palette)
 * Update: Daily at ~12:00 UTC, NRT (24h latency)
 * Auth: None required — free open access
 * License: Copernicus Marine Service (free, open)
 *
 * Uses WMTS tiles in EPSG:3857 for direct MapLibre integration.
 * Only visible in Rías Baixas sector (ocean context).
 */

// ── Config ──────────────────────────────────────────

const PRODUCT = 'SST_ATL_SST_L4_NRT_OBSERVATIONS_010_025';
const DATASET = 'IFREMER-ATL-SST-L4-NRT-OBS_FULL_TIME_SERIE_201904';
const VARIABLE = 'analysed_sst';
const STYLE = 'cmap:thermal';

/** Get yesterday's date (latest available — NRT has ~24h lag) */
function getLatestDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0] + 'T00:00:00.000Z';
}

/**
 * Build WMTS KVP tile URL template for MapLibre raster source.
 * MapLibre replaces {z}, {x}, {y} automatically.
 */
function buildTileUrl(): string {
  const base = 'https://wmts.marine.copernicus.eu/teroWmts';
  const layer = encodeURIComponent(`${PRODUCT}/${DATASET}/${VARIABLE}`);
  const style = encodeURIComponent(STYLE);
  const time = encodeURIComponent(getLatestDate());
  // {z}, {x}, {y} must stay literal — MapLibre replaces them per tile
  return `${base}?service=WMTS&request=GetTile&version=1.0.0&layer=${layer}&style=${style}&format=image/png&TileMatrixSet=EPSG:3857&TileMatrix={z}&TileRow={y}&TileCol={x}&time=${time}`;
}

// ── Component ───────────────────────────────────────

export function SSTOverlay() {
  const visible = useUIStore((s) => s.sstVisible);
  const sectorId = useSectorStore((s) => s.activeSector.id);

  if (!visible || sectorId !== 'rias') return null;

  return (
    <Source
      id="cmems-sst"
      type="raster"
      tiles={[buildTileUrl()]}
      tileSize={256}
      maxzoom={10}
      attribution="&copy; Copernicus Marine Service — SST NRT"
    >
      <Layer
        id="sst-layer"
        type="raster"
        paint={{
          'raster-opacity': 0.6,
          'raster-fade-duration': 300,
        }}
      />
    </Source>
  );
}
