/**
 * MeteoGalicia webcam definitions — sourced from official JSON API.
 * API: https://servizos.meteogalicia.gal/mgrss/observacion/jsonCamaras.action
 *
 * Image URL pattern:
 *   https://www.meteogalicia.gal/datosred/camaras/MeteoGalicia/{dir}/ultima.jpg
 *
 * Webcams are displayed as triangle markers on the map, rotated by azimuth.
 * Vision IA (Ollama/SmolVLM2) processes images in background for Beaufort estimation.
 */

import type { SpotId } from './spots';

export interface WebcamStation {
  id: string;
  name: string;
  source: 'meteogalicia' | 'dgt';
  lat: number;
  lon: number;
  /** Camera viewing direction in degrees from north */
  azimuth: number;
  /** Direct URL to latest image (JPG, auto-refreshed by MG) */
  imageUrl: string;
  /** Refresh interval in seconds */
  refreshInterval: number;
  /** Which sector this camera is relevant for */
  sector: 'rias' | 'embalse' | 'all';
  /** Nearest sailing spot (for cross-reference in popup) */
  nearestSpotId?: SpotId;
  /** Province */
  province: string;
  /** Municipality */
  concello: string;
  /** Optional: what this camera is useful for (fog detection, wind validation) */
  purpose?: string;
}

const MG_IMG_BASE = 'https://www.meteogalicia.gal/datosred/camaras/MeteoGalicia';

// ── Rías Baixas cameras (primary — near sailing spots) ──────

export const RIAS_WEBCAMS: WebcamStation[] = [
  {
    id: 'mg-ciesrodas',
    name: 'Cies Rodas',
    source: 'meteogalicia',
    lat: 42.2189, lon: -8.9040,
    azimuth: 180, // Sur — playa de Rodas
    imageUrl: `${MG_IMG_BASE}/Ciesrodas/ultima.jpg`,
    refreshInterval: 300,
    sector: 'rias',
    nearestSpotId: 'cies-ria',
    province: 'Pontevedra', concello: 'Vigo',
  },
  {
    id: 'mg-ciesfaro-sur',
    name: 'Cies Faro Sur',
    source: 'meteogalicia',
    lat: 42.2141, lon: -8.9147,
    azimuth: 180, // Sur — oceano abierto
    imageUrl: `${MG_IMG_BASE}/CiesFaroSur/ultima.jpg`,
    refreshInterval: 300,
    sector: 'rias',
    nearestSpotId: 'cies-ria',
    province: 'Pontevedra', concello: 'Vigo',
  },
  {
    id: 'mg-ciesfaro-norte',
    name: 'Cies Faro Norte',
    source: 'meteogalicia',
    lat: 42.2142, lon: -8.9147,
    azimuth: 0, // Norte — mira hacia la ria de Vigo
    imageUrl: `${MG_IMG_BASE}/CiesFaroNorte/ultima.jpg`,
    refreshInterval: 300,
    sector: 'rias',
    nearestSpotId: 'cies-ria',
    province: 'Pontevedra', concello: 'Vigo',
  },
  {
    id: 'mg-cangas',
    name: 'Cangas',
    source: 'meteogalicia',
    lat: 42.2604, lon: -8.7826,
    azimuth: 120, // SE — Ria de Vigo, bruma, visibilidad
    imageUrl: `${MG_IMG_BASE}/Cangas/ultima.jpg`,
    refreshInterval: 300,
    sector: 'rias',
    nearestSpotId: 'centro-ria',
    province: 'Pontevedra', concello: 'Cangas',
  },
  {
    id: 'mg-aguete',
    name: 'Aguete (Marin)',
    source: 'meteogalicia',
    lat: 42.3759, lon: -8.7290,
    azimuth: 225, // SW — Ria de Pontevedra
    imageUrl: `${MG_IMG_BASE}/Aguete2/ultima.jpg`,
    refreshInterval: 300,
    sector: 'rias',
    nearestSpotId: 'lourido',
    province: 'Pontevedra', concello: 'Marin',
  },
  {
    id: 'mg-ons-praia',
    name: 'Ons Praia',
    source: 'meteogalicia',
    lat: 42.3769, lon: -8.9322,
    azimuth: 180, // Sur — oceano + linea de islas
    imageUrl: `${MG_IMG_BASE}/Onsplaya/ultima.jpg`,
    refreshInterval: 300,
    sector: 'rias',
    province: 'Pontevedra', concello: 'Bueu',
  },
  {
    id: 'mg-ons-porto',
    name: 'Ons Porto',
    source: 'meteogalicia',
    lat: 42.3769, lon: -8.9321,
    azimuth: 270, // Oeste — oceano abierto
    imageUrl: `${MG_IMG_BASE}/Onspuerto/ultima.jpg`,
    refreshInterval: 300,
    sector: 'rias',
    province: 'Pontevedra', concello: 'Bueu',
  },
  {
    id: 'mg-castrove',
    name: 'Castrove (alto)',
    source: 'meteogalicia',
    lat: 42.4584, lon: -8.7221,
    azimuth: 270, // Oeste — panoramica ria Pontevedra
    imageUrl: `${MG_IMG_BASE}/Castrove/ultima.jpg`,
    refreshInterval: 300,
    sector: 'rias',
    province: 'Pontevedra', concello: 'Poio',
  },
  {
    id: 'mg-salvora',
    name: 'Salvora',
    source: 'meteogalicia',
    lat: 42.4714, lon: -9.0059,
    azimuth: 180, // Sur — boca ria Arousa, bruma
    imageUrl: `${MG_IMG_BASE}/Salvora/ultima.jpg`,
    refreshInterval: 300,
    sector: 'rias',
    nearestSpotId: 'castineiras',
    province: 'A Coruna', concello: 'Ribeira',
  },
  {
    id: 'mg-coron',
    name: 'Coron',
    source: 'meteogalicia',
    lat: 42.5801, lon: -8.8047,
    azimuth: 270, // Oeste — Arousa interior
    imageUrl: `${MG_IMG_BASE}/Coron/ultima.jpg`,
    refreshInterval: 300,
    sector: 'rias',
    nearestSpotId: 'illa-arousa',
    province: 'Pontevedra', concello: 'Vilanova de Arousa',
  },
  {
    id: 'mg-corrubedo',
    name: 'Corrubedo',
    source: 'meteogalicia',
    lat: 42.5552, lon: -9.0286,
    azimuth: 270, // Oeste — Atlantico abierto
    imageUrl: `${MG_IMG_BASE}/Corrubedo/ultima.jpg`,
    refreshInterval: 300,
    sector: 'rias',
    province: 'A Coruna', concello: 'Ribeira',
  },
  {
    id: 'mg-baiona',
    name: 'Baiona',
    source: 'meteogalicia',
    lat: 42.1155, lon: -8.8372,
    azimuth: 270, // Oeste — Atlantico
    imageUrl: `${MG_IMG_BASE}/Baiona/ultima.jpg`,
    refreshInterval: 300,
    sector: 'rias',
    province: 'Pontevedra', concello: 'Baiona',
  },
];

// ── Costa norte + Costa da Morte (future expansion) ──────

export const NORTH_WEBCAMS: WebcamStation[] = [
  {
    id: 'mg-corunha',
    name: 'A Coruna (Dique)',
    source: 'meteogalicia',
    lat: 43.3651, lon: -8.3747,
    azimuth: 315,
    imageUrl: `${MG_IMG_BASE}/Corunha/ultima.jpg`,
    refreshInterval: 300,
    sector: 'all',
    province: 'A Coruna', concello: 'A Coruna',
  },
  {
    id: 'mg-langosteira',
    name: 'Langosteira',
    source: 'meteogalicia',
    lat: 43.3472, lon: -8.5312,
    azimuth: 270,
    imageUrl: `${MG_IMG_BASE}/Langosteira/ultima.jpg`,
    refreshInterval: 300,
    sector: 'all',
    province: 'A Coruna', concello: 'Arteixo',
  },
  {
    id: 'mg-camarinhas',
    name: 'Camarinas',
    source: 'meteogalicia',
    lat: 43.1245, lon: -9.1783,
    azimuth: 270,
    imageUrl: `${MG_IMG_BASE}/Camarinhas/ultima.jpg`,
    refreshInterval: 300,
    sector: 'all',
    province: 'A Coruna', concello: 'Camarinas',
  },
  {
    id: 'mg-puntacandieira',
    name: 'Punta Candieira',
    source: 'meteogalicia',
    lat: 43.7043, lon: -8.0525,
    azimuth: 0,
    imageUrl: `${MG_IMG_BASE}/PuntaCandieira/ultima.jpg`,
    refreshInterval: 300,
    sector: 'all',
    province: 'A Coruna', concello: 'Cedeira',
  },
  {
    id: 'mg-portosin',
    name: 'Portosin',
    source: 'meteogalicia',
    lat: 42.7656, lon: -8.9485,
    azimuth: 225,
    imageUrl: `${MG_IMG_BASE}/Portosin/ultima.jpg`,
    refreshInterval: 300,
    sector: 'all',
    province: 'A Coruna', concello: 'Porto do Son',
  },
  {
    id: 'mg-muros',
    name: 'Carnota (Muros)',
    source: 'meteogalicia',
    lat: 42.8092, lon: -9.0771,
    azimuth: 270,
    imageUrl: `${MG_IMG_BASE}/Muros/ultima.jpg`,
    refreshInterval: 300,
    sector: 'all',
    province: 'A Coruna', concello: 'Muros',
  },
  {
    id: 'mg-burela',
    name: 'Burela',
    source: 'meteogalicia',
    lat: 43.6560, lon: -7.3444,
    azimuth: 0,
    imageUrl: `${MG_IMG_BASE}/Burela/ultima.jpg`,
    refreshInterval: 300,
    sector: 'all',
    province: 'Lugo', concello: 'Burela',
  },
];

// ── Embalse / Valle Miño cameras (DGT traffic cams — fog validation) ──

const DGT_IMG_BASE = 'https://infocar.dgt.es/etraffic/data/camaras';

export const EMBALSE_WEBCAMS: WebcamStation[] = [
  {
    id: 'dgt-ribadavia',
    name: 'Ribadavia N-120 (DGT)',
    source: 'dgt',
    lat: 42.2887, lon: -8.1430,
    azimuth: 270, // W — valle del Miño
    imageUrl: `${DGT_IMG_BASE}/1187.jpg`,
    refreshInterval: 600, // DGT refreshes ~10min
    sector: 'embalse',
    nearestSpotId: 'castrelo',
    province: 'Ourense', concello: 'Ribadavia',
    purpose: 'Fog validation valley floor',
  },
  {
    id: 'dgt-fea-arrabaldo',
    name: 'Fea-Arrabaldo AG-53 (DGT)',
    source: 'dgt',
    lat: 42.3230, lon: -7.9860,
    azimuth: 180, // S — parte alta embalse
    imageUrl: `${DGT_IMG_BASE}/557.jpg`,
    refreshInterval: 600,
    sector: 'embalse',
    province: 'Ourense', concello: 'Ourense',
    purpose: 'Fog validation upper reservoir',
  },
];

/** All webcams */
export const ALL_WEBCAMS: WebcamStation[] = [...RIAS_WEBCAMS, ...NORTH_WEBCAMS, ...EMBALSE_WEBCAMS];

/** Get webcams for a sector */
export function getWebcamsForSector(sectorId: string): WebcamStation[] {
  if (sectorId === 'rias') return RIAS_WEBCAMS;
  if (sectorId === 'embalse') return EMBALSE_WEBCAMS;
  return [];
}
