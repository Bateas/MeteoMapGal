/**
 * Sailing spot definitions — multi-sector.
 *
 * A "spot" is a micro-zone within a sector with its own scoring profile,
 * preferred stations/buoys, and wind pattern knowledge. The sector fetches
 * ALL stations; the spot narrows scoring to what matters locally.
 *
 * Rías Baixas — 4 spots in Ría de Vigo (expandable to other Rías):
 * - Cesantes: interior, thermal-dominant, flat water
 * - Bocana: Vigo–Rande narrows, terral wind from ría interior, sheltered water
 * - Centro Ría: mid-ría, virazón territory, moderate wave exposure
 * - Cíes-Ría: exterior, full ocean conditions, swell-critical
 *
 * Embalse — 1 spot (expandable):
 * - Castrelo: reservoir center, thermal WSW dominant
 */

import type { IconId } from '../components/icons/WeatherIcons';

/** Type-safe spot identifiers for exhaustive matching */
export type SpotId = 'cesantes' | 'bocana' | 'centro-ria' | 'cies-ria' | 'lourido' | 'castrelo';

export interface WindPattern {
  name: string;
  /** Typical direction (degrees from north) */
  direction: number;
  /** Season/timing description */
  season: string;
  /** Short description */
  description: string;
}

export interface SpotWebcam {
  /** Display label */
  label: string;
  /** URL to open or embed */
  url: string;
  /** 'image' = static JPG (auto-refresh), 'page' = external page/stream link */
  type: 'image' | 'page';
  /** Provider name */
  source: string;
  /** Compass direction the camera faces (degrees from north) */
  azimuth: number;
  /** Auto-refresh interval in seconds (only for type='image') */
  refreshInterval?: number;
}

export interface SailingSpot {
  id: SpotId;
  name: string;
  shortName: string;
  /** Icon from WeatherIcons registry */
  icon: IconId;
  center: [number, number]; // [lon, lat]
  radiusKm: number;
  description: string;
  /** Known wind patterns for this spot */
  windPatterns: WindPattern[];
  /** Station IDs to prioritize for scoring (prefixed: aemet_, mg_, mc_, wu_, nt_) */
  preferredStations: string[];
  /** Buoy IDs to prioritize (from RIAS_BUOY_STATIONS) */
  preferredBuoys: number[];
  /** Wave relevance for scoring */
  waveRelevance: 'none' | 'moderate' | 'critical';
  /** Whether thermal wind detection applies */
  thermalDetection: boolean;
  /** Safety hard gates */
  hardGates: {
    /** Max wind (kt) before NOGO */
    maxWindKt?: number;
    /** Max significant wave height (m) before NOGO */
    maxWaveHeight?: number;
  };
  /** Wind speed calibration offset (kt). Added to consensus avg to compensate
   *  for amateur station low-mounting bias or exposed locations. Default 0. */
  windCalibrationKt?: number;
  /** Webcams near this spot (Phase 1) */
  webcams?: SpotWebcam[];
  /** Nearest IHM tide station ID (from tideClient.ts) for tide summary in popup */
  tideStationId?: string;
}

// ── Spot Definitions ──────────────────────────────────────────

export const RIAS_SPOTS: SailingSpot[] = [
  {
    id: 'cesantes',
    name: 'Cesantes (Interior)',
    shortName: 'Cesantes',
    icon: 'sailboat',
    center: [-8.619, 42.307],
    radiusKm: 12,
    description: 'Interior Ría de Vigo, ensenada de San Simón. Agua plana, viento térmico WSW tardes.',
    windPatterns: [
      {
        name: 'Térmica WSW',
        direction: 250,
        season: 'Feb–Oct, tardes',
        description: 'Térmica del valle WSW 250°, 12-20kt. Requiere T>16°C, cielo despejado, sin componente norte.',
      },
      {
        name: 'Norte canalizado',
        direction: 0,
        season: 'Todo el año',
        description: 'Norte N 0° canalizado por Rande. Racheado e irregular, anula la térmica.',
      },
    ],
    // Closest stations to Cesantes scoring zone
    preferredStations: [
      'mc_ESGAL3600000036260A', // Redondela (~2km)
      'mc_ESGAL3600000036057A', // Vigo Centro (~9km)
    ],
    preferredBuoys: [
      1251, // Rande CETMAR (~3km) — key buoy for interior ría
      3221, // Vigo REDMAR (tide/pressure, ~5km)
    ],
    waveRelevance: 'none',
    thermalDetection: true,
    hardGates: { maxWindKt: 30 },
    tideStationId: '29', // Vigo
    webcams: [
      {
        label: 'Cesantes (tmkites)',
        url: 'https://www.tmkites.com/playas/cesantes/',
        type: 'page',
        source: 'tmkites',
        azimuth: 270, // Mirando al oeste (ría)
      },
    ],
  },
  {
    id: 'bocana',
    name: 'Bocana (Vigo–Rande)',
    shortName: 'Bocana',
    icon: 'sailboat',
    center: [-8.70, 42.265],
    radiusKm: 10,
    description: 'Estrecho de Rande, Vigo–San Simón. Terral matutino E/ENE, agua protegida.',
    windPatterns: [
      {
        name: 'Terral E/ENE',
        direction: 75,
        season: 'Otoño–Primavera, mañanas (0-9h)',
        description: 'Terral E/ENE 50-100°, aire frío drena por Rande hacia Vigo. Requiere noche clara y fría.',
      },
      {
        name: 'Norte canalizado',
        direction: 0,
        season: 'Todo el año',
        description: 'Norte N 0° canalizado por el estrecho. Racheado e irregular.',
      },
    ],
    // Stations closest to the Rande–Vigo channel
    preferredStations: [
      'mc_ESGAL3600000036260A', // Redondela (~3km)
      'mc_ESGAL3600000036057A', // Vigo Centro (~3km)
      'mc_ESGAL3600000036041A', // Vigo Bouzas (~4km)
    ],
    preferredBuoys: [
      1251, // Rande CETMAR — directly at Rande narrows
      3221, // Vigo REDMAR (sea level, ~2km)
    ],
    waveRelevance: 'none', // Protected from ocean swell by the ría
    thermalDetection: false,
    hardGates: { maxWindKt: 30 },
    tideStationId: '29', // Vigo
    webcams: [
      {
        label: 'Vigo Móvil (Ría)',
        url: 'https://www.g24.gal/-/vigo-mobil-',
        type: 'page',
        source: 'G24',
        azimuth: 315, // Mirando NW (bocana → Cangas)
      },
    ],
  },
  {
    id: 'centro-ria',
    name: 'Centro Ría (Canido–Limens)',
    shortName: 'C. Ría',
    icon: 'sailboat',
    center: [-8.80, 42.215],
    radiusKm: 10,
    description: 'Zona media Ría de Vigo, Canido–Limens. Virazón SW tardes, oleaje moderado.',
    windPatterns: [
      {
        name: 'Terral E/ENE',
        direction: 75,
        season: 'Otoño–Primavera, mañanas',
        description: 'Terral E/ENE 50-100° desde Rande, pierde intensidad al ensancharse la ría.',
      },
      {
        name: 'Virazón SW',
        direction: 225,
        season: 'Tardes de verano',
        description: 'Brisa marina SW 225°, se desarrolla tras mañanas de calma.',
      },
      {
        name: 'Norte NW',
        direction: 330,
        season: 'Frentes fríos',
        description: 'NW 330° asociado a frentes. Patrón pluridía con mar cruzada.',
      },
    ],
    preferredStations: [
      'mc_ESGAL3600000036940A', // Cangas do Morrazo (~8km N) — fixed: was 36440A/404
      'mc_ESGAL3600000036041A', // Vigo Bouzas (~5km S)
    ],
    preferredBuoys: [
      1251, // Rande CETMAR (~8km NE)
      3221, // Vigo REDMAR (sea level, ~3km S)
      4273, // Cabo Udra REMPOR (~10km S, wind)
    ],
    waveRelevance: 'moderate',
    thermalDetection: false,
    hardGates: { maxWindKt: 30, maxWaveHeight: 2.0 },
    tideStationId: '29', // Vigo
    webcams: [
      {
        label: 'Vigo Móvil (Ría)',
        url: 'https://www.g24.gal/-/vigo-mobil-',
        type: 'page',
        source: 'G24',
        azimuth: 315, // Mirando NW (centro ría)
      },
    ],
  },
  {
    id: 'cies-ria',
    name: 'Cíes-Ría (Baiona–Cíes)',
    shortName: 'Cíes-Ría',
    icon: 'sailboat',
    center: [-8.8648, 42.1849],
    radiusKm: 12,
    description: 'Entrada Ría de Vigo, Baiona–Cíes. Condiciones oceánicas, nortada verano, mar de fondo.',
    windPatterns: [
      {
        name: 'Nortada NW',
        direction: 330,
        season: 'Verano, tardes',
        description: 'NW 295-330°, 12-20kt. Dominante en tardes de verano. Mar de fondo variable.',
      },
      {
        name: 'SW frontal',
        direction: 225,
        season: 'Invierno',
        description: 'SW 225° asociado a borrascas atlánticas. Mar de 2-4m, viento fuerte.',
      },
    ],
    preferredStations: [
      'mc_ESGAL3600000036510A', // Baiona (~8km)
    ],
    preferredBuoys: [
      2248, // Cabo Silleiro REDEXT (referencia oceánica, 55km W)
      1253, // A Guarda CETMAR (sur)
      1252, // Islas Cíes CETMAR (bocana directa)
    ],
    waveRelevance: 'critical',
    thermalDetection: false,
    hardGates: { maxWindKt: 30, maxWaveHeight: 3.0 },
    tideStationId: '30', // Baiona
    webcams: [
      {
        label: 'Cíes – Rodas (MeteoGalicia)',
        url: 'https://www.meteogalicia.gal/datosred/infoweb/clima/webcams/Ciesrodas/ultima.jpg',
        type: 'image',
        source: 'MeteoGalicia',
        azimuth: 180, // Mirando al sur (playa de Rodas)
        refreshInterval: 300, // 5 min
      },
    ],
  },
  {
    id: 'lourido',
    name: 'Lourido (Ría de Pontevedra)',
    shortName: 'Lourido',
    icon: 'beach',
    center: [-8.679265, 42.420740],
    radiusKm: 10,
    description: 'Playa de Lourido, Ría de Pontevedra. Kite/windsurf spot con virazón SW tardes.',
    windPatterns: [
      {
        name: 'Virazón SW',
        direction: 225,
        season: 'Primavera–Otoño, tardes',
        description: 'Brisa marina SW 200-240°, 10-18kt. Se desarrolla con ΔT tierra-mar y cielo despejado.',
      },
      {
        name: 'Norte NW',
        direction: 330,
        season: 'Frentes fríos',
        description: 'NW 310-350° asociado a frentes. Choppy con marejadilla en la ría.',
      },
    ],
    preferredStations: [
      'mc_ESGAL3600000036940A', // Cangas do Morrazo (~10km W)
    ],
    preferredBuoys: [
      4271, // Lourizán REMPOR (~3km SE, has wind!)
      4273, // Cabo Udra REMPOR (~8km W, has wind)
      3223, // Marín REDMAR (tide gauge, ~3km S)
    ],
    waveRelevance: 'moderate',
    thermalDetection: false,
    windCalibrationKt: 2, // Exposed beach, stations ~10km away + amateur low-mount bias
    hardGates: { maxWindKt: 30, maxWaveHeight: 2.5 },
    tideStationId: '28', // Marín
    webcams: [
      {
        label: 'Lourido (KiteGalicia)',
        url: 'https://kitegalicia.com/playas/centro-kg-lourido/',
        type: 'page',
        source: 'KiteGalicia',
        azimuth: 225, // Mirando SW (ría)
      },
    ],
  },
];

export const EMBALSE_SPOTS: SailingSpot[] = [
  {
    id: 'castrelo',
    name: 'Castrelo de Miño (Embalse)',
    shortName: 'Castrelo',
    icon: 'sailboat',
    center: [-8.1087, 42.2991],
    radiusKm: 15,
    description: 'Embalse Castrelo de Miño, valle del Miño. Agua dulce, térmica WSW tardes.',
    windPatterns: [
      {
        name: 'Térmica WSW',
        direction: 250,
        season: 'Feb–Oct, tardes',
        description: 'Térmica del valle WSW 250°, 12-20kt. Requiere T>16°C, cielo despejado, sin componente norte.',
      },
      {
        name: 'Norte',
        direction: 0,
        season: 'Todo el año',
        description: 'Norte N 0° racheado e irregular. Anula el desarrollo de la térmica.',
      },
    ],
    preferredStations: [
      'aemet_1484C', // Ribadavia (~5km)
      'aemet_1496',  // Ourense (~15km)
    ],
    preferredBuoys: [], // No buoys in freshwater reservoir
    waveRelevance: 'none',
    thermalDetection: true,
    hardGates: { maxWindKt: 30 },
  },
];

/** All spots from both sectors */
export const ALL_SPOTS: SailingSpot[] = [...RIAS_SPOTS, ...EMBALSE_SPOTS];

/** Get spots for a specific sector */
export function getSpotsForSector(sectorId: string): SailingSpot[] {
  if (sectorId === 'rias') return RIAS_SPOTS;
  if (sectorId === 'embalse') return EMBALSE_SPOTS;
  return [];
}

/** Default spot per sector */
export function getDefaultSpotId(sectorId: string): SpotId {
  if (sectorId === 'embalse') return 'castrelo';
  return 'cesantes'; // Rías default
}

export const DEFAULT_SPOT_ID = 'cesantes';
