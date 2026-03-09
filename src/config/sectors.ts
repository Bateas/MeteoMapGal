/**
 * Sector definitions — independent geographic monitoring regions.
 *
 * Each sector has its own center, radius, initial viewport, and
 * Meteoclimatic region feeds. Station discovery runs per-sector.
 */

import type { IconId } from '../components/icons/WeatherIcons';

export interface Sector {
  id: string;
  name: string;
  shortName: string;
  icon: IconId;
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
  /** Extra points outside the main radius — stations within 8km of these are included */
  extraCoveragePoints?: { name: string; lon: number; lat: number }[];
}

export const SECTORS: Sector[] = [
  {
    id: 'rias',
    name: 'Rías Baixas',
    shortName: 'Rías',
    icon: 'waves',
    center: [-8.68, 42.30],          // centered between Vigo/Pontevedra/Arousa
    radiusKm: 40,                     // covers all 3 rías (Vigo + Pontevedra + Arousa)
    initialView: {
      longitude: -8.72,
      latitude: 42.35,
      zoom: 10,
      pitch: 40,
      bearing: 0,
    },
    meteoclimaticRegions: ['ESGAL36', 'ESGAL15'],  // Pontevedra + A Coruña (Barbanza/Ribeira)
    extraCoveragePoints: [
      { name: 'Corrubedo',  lon: -9.08, lat: 42.56 },  // 44km from center — Barbanza coast
      { name: 'A Guarda',   lon: -8.88, lat: 41.90 },  // 47km from center — Miño estuary
    ],
  },
  {
    id: 'embalse',
    name: 'Embalse de Castrelo',
    shortName: 'Embalse',
    icon: 'sailboat',
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
];

export const DEFAULT_SECTOR_ID = 'embalse';
