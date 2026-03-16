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
    radiusKm: 30,                     // coastal focus — covers 3 Rías without deep interior stations
    initialView: {
      longitude: -8.72,
      latitude: 42.35,
      zoom: 10,
      pitch: 40,
      bearing: 0,
    },
    meteoclimaticRegions: ['ESGAL36', 'ESGAL15'],  // Pontevedra + A Coruña (Barbanza/Ribeira)
    extraCoveragePoints: [
      { name: 'Corrubedo',   lon: -9.08, lat: 42.56 },  // 44km — Barbanza coast
      { name: 'Sálvora',     lon: -9.006, lat: 42.471 }, // 33km — Isla Sálvora (MG 10134)
      { name: 'A Guarda',    lon: -8.88, lat: 41.90 },  // 47km — Miño estuary
      { name: 'Vilagarcía',  lon: -8.77, lat: 42.60 },  // 34km — Arousa ría port
      { name: 'Ribeira',     lon: -8.99, lat: 42.56 },  // 39km — Arousa south coast
      { name: 'Muros',       lon: -9.0153, lat: 42.7195 }, // ~45km — Ría de Muros-Noia (Obs. Costeiro)
      { name: 'Vigo Costa', lon: -8.73, lat: 42.22 },  // ~9km — Vigo coastal PWS (WU, Bouzas, Alcabre, Baia)
      { name: 'Baiona',     lon: -8.85, lat: 42.12 },  // ~22km — Baiona/Nigrán coast
      { name: 'Sanxenxo',   lon: -8.81, lat: 42.40 },  // ~16km — Sanxenxo/Portonovo coast
      { name: 'O Grove',    lon: -8.86, lat: 42.49 },  // ~24km — O Grove/Cambados/Arousa inner ría
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
