/**
 * Sector definitions — independent geographic monitoring regions.
 *
 * Each sector has its own center, radius, initial viewport, and
 * Meteoclimatic region feeds. Station discovery runs per-sector.
 */

export interface Sector {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  center: [number, number];         // [lon, lat]
  radiusKm: number;
  initialView: {
    longitude: number;
    latitude: number;
    zoom: number;
    pitch: number;
    bearing: number;
  };
  /** Meteoclimatic region codes to fetch for this sector */
  meteoclimaticRegions: string[];
}

export const SECTORS: Sector[] = [
  {
    id: 'embalse',
    name: 'Embalse de Castrelo',
    shortName: 'Embalse',
    icon: '⛵',
    center: [-8.1, 42.29],
    radiusKm: 35,
    initialView: {
      longitude: -8.1,
      latitude: 42.29,
      zoom: 11,
      pitch: 50,
      bearing: -15,
    },
    meteoclimaticRegions: ['ESGAL32', 'ESGAL36'],
  },
  {
    id: 'rias',
    name: 'Rías Baixas',
    shortName: 'Rías',
    icon: '🌊',
    center: [-8.65, 42.25],
    radiusKm: 30,
    initialView: {
      longitude: -8.65,
      latitude: 42.25,
      zoom: 11,
      pitch: 40,
      bearing: 0,
    },
    meteoclimaticRegions: ['ESGAL36'],
  },
];

export const DEFAULT_SECTOR_ID = 'embalse';
