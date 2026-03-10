/**
 * Sailing spot definitions for Rías Baixas sector.
 *
 * A "spot" is a micro-zone within a sector with its own scoring profile,
 * preferred stations/buoys, and wind pattern knowledge. The sector fetches
 * ALL stations; the spot narrows scoring to what matters locally.
 *
 * 4 spots in Ría de Vigo (expandable to other Rías):
 * - Cesantes: interior, thermal-dominant, flat water
 * - Bocana: Vigo–Rande narrows, bocana wind zone, sheltered water
 * - Centro Ría: mid-ría, virazón territory, moderate wave exposure
 * - Cíes-Ría: exterior, full ocean conditions, swell-critical
 */

import type { IconId } from '../components/icons/WeatherIcons';

export interface WindPattern {
  name: string;
  /** Typical direction (degrees from north) */
  direction: number;
  /** Season/timing description */
  season: string;
  /** Short description */
  description: string;
}

export interface SailingSpot {
  id: string;
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
}

// ── Spot Definitions ──────────────────────────────────────────

export const RIAS_SPOTS: SailingSpot[] = [
  {
    id: 'cesantes',
    name: 'Cesantes (Interior)',
    shortName: 'Cesantes',
    icon: 'anchor',
    center: [-8.619, 42.307],
    radiusKm: 8,
    description: 'Ensenada de San Simón. Agua plana, viento térmico WSW dominante.',
    windPatterns: [
      {
        name: 'Térmica WSW',
        direction: 250,
        season: 'Feb–Oct, tardes',
        description: 'Térmica del valle, 12-20kt. Necesita: T>16°C, cielo despejado, sin norte.',
      },
      {
        name: 'Norte canalizado',
        direction: 0,
        season: 'Todo el año',
        description: 'Norte que entra por Rande. Racheado, frío, mata la térmica.',
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
  },
  {
    id: 'bocana',
    name: 'Bocana (Vigo–Rande)',
    shortName: 'Bocana',
    icon: 'anchor',
    center: [-8.70, 42.265],
    radiusKm: 6,
    description: 'Estrecho de Rande → Vigo. Zona del viento de bocana: sale del estrecho y recorre la ría.',
    windPatterns: [
      {
        name: 'Bocana',
        direction: 75,
        season: 'Otoño–Primavera, mañanas frías (0-9h)',
        description: 'Catabático E/ENE (50-100°): aire frío drena por Rande. Requiere noche clara y fría. Ausente en verano y con nubes.',
      },
      {
        name: 'Norte canalizado',
        direction: 0,
        season: 'Todo el año',
        description: 'Norte que entra desde el estrecho. Racheado, frío.',
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
  },
  {
    id: 'centro-ria',
    name: 'Centro Ría (Canido–Limens)',
    shortName: 'C. Ría',
    icon: 'anchor',
    center: [-8.80, 42.215],
    radiusKm: 10,
    description: 'Zona media de la ría. Bocana matutina, virazón de tarde. Oleaje moderado.',
    windPatterns: [
      {
        name: 'Bocana',
        direction: 75,
        season: 'Otoño–Primavera, mañanas frías',
        description: 'Catabático E/ENE debilitado. Llega desde Rande, pierde fuerza en centro ría.',
      },
      {
        name: 'Virazón SW',
        direction: 225,
        season: 'Tardes de verano',
        description: 'Brisa marina SW. Se desarrolla tras mañanas de calma.',
      },
      {
        name: 'Norte NW',
        direction: 330,
        season: 'Frentes fríos',
        description: 'Patrón pluridía, frío. Crea mar cruzada en centro ría.',
      },
    ],
    preferredStations: [
      'mc_ESGAL3600000036440A', // Cangas do Morrazo (~8km N)
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
  },
  {
    id: 'cies-ria',
    name: 'Cíes-Ría (Baiona–Cíes)',
    shortName: 'Cíes-Ría',
    icon: 'anchor',
    center: [-8.92, 42.17],
    radiusKm: 12,
    description: 'Entrada de la ría y costa exterior. Condiciones oceánicas: mar de fondo, nortada, upwelling.',
    windPatterns: [
      {
        name: 'Nortada',
        direction: 330,
        season: 'Verano',
        description: 'NW 295-330° dominante 12-20kt en verano (42% NW tardes). Buena navegación, agua fría (upwelling).',
      },
      {
        name: 'SW frontal',
        direction: 225,
        season: 'Invierno',
        description: 'Fuerte con mar de 2-4m. Peligroso para embarcaciones pequeñas.',
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
  },
];

export const DEFAULT_SPOT_ID = 'cesantes';
