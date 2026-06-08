/**
 * Copernicus Marine (CMEMS) Sea Surface Temperature overlay.
 *
 * Product: SST_ATL_SST_L4_NRT_OBSERVATIONS_010_025 (Atlantic IBI region)
 * Layer: analysed_sst — daily L4 gap-free SST from IFREMER, ~2 km, NRT (24h lag).
 * Auth: none (free open access). WMTS EPSG:3857 tiles for MapLibre.
 * Only visible in coastal sectors (ocean context).
 */
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { isCoastalSector } from '../../config/sectors';
import { RasterTileOverlay } from './RasterTileOverlay';

const PRODUCT = 'SST_ATL_SST_L4_NRT_OBSERVATIONS_010_025';
const DATASET = 'IFREMER-ATL-SST-L4-NRT-OBS_FULL_TIME_SERIE_201904';
const VARIABLE = 'analysed_sst';
const STYLE = 'cmap:thermal';

/** Yesterday (latest available — NRT has ~24h lag). */
function getLatestDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0] + 'T00:00:00.000Z';
}

/** Build the WMTS KVP tile URL template ({z}/{x}/{y} stay literal for MapLibre). */
function buildTileUrl(): string {
  const base = 'https://wmts.marine.copernicus.eu/teroWmts';
  const layer = encodeURIComponent(`${PRODUCT}/${DATASET}/${VARIABLE}`);
  const style = encodeURIComponent(STYLE);
  const time = encodeURIComponent(getLatestDate());
  return `${base}?service=WMTS&request=GetTile&version=1.0.0&layer=${layer}&style=${style}&format=image/png&TileMatrixSet=EPSG:3857&TileMatrix={z}&TileRow={y}&TileCol={x}&time=${time}`;
}

export function SSTOverlay() {
  const visible = useUIStore((s) => s.sstVisible);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  return (
    <RasterTileOverlay
      visible={visible && isCoastalSector(sectorId)}
      sourceId="cmems-sst"
      layerId="sst-layer"
      tiles={[buildTileUrl()]}
      maxzoom={10}
      opacity={0.6}
      fadeDuration={300}
      attribution="© Copernicus Marine Service — SST NRT"
    />
  );
}
