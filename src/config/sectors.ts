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
  /**
   * Coastal sector → enables marine features: buoys, tides, currents (HF radar),
   * SST, nearshore waves (SWAN), bathymetry, seamarks, nautical charts, upwelling,
   * advective fog, sea breeze. Inland sectors (false) get thermal features instead.
   * Drives all marine-vs-inland gating across the app (use isCoastalSector()).
   */
  coastal: boolean;
}

export const SECTORS: Sector[] = [
  {
    id: 'rias',
    name: 'Rías Baixas',
    shortName: 'Rías',
    icon: 'waves',
    coastal: true,
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
      { name: 'Cangas',     lon: -8.79, lat: 42.26 },  // ~12km — O Morrazo peninsula (Cangas, Bueu)
      { name: 'Sanxenxo',   lon: -8.81, lat: 42.40 },  // ~16km — Sanxenxo/Portonovo coast
      { name: 'O Grove',    lon: -8.86, lat: 42.49 },  // ~24km — O Grove/Cambados/Arousa inner ría
    ],
  },
  {
    id: 'embalse',
    name: 'Embalse de Castrelo',
    shortName: 'Embalse',
    icon: 'sailboat',
    coastal: false,
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
    // No extraCoveragePoints needed: 35km radius covers Ribadavia (17km), Ourense (20km),
    // San Amaro (15km), Remuño (8km). Thermal wind is W/WSW (solar-driven, NOT river-channeled).
    // Altitude matters: embalse ~95m — stations >300m are different wind regimes.
  },
];

export const DEFAULT_SECTOR_ID = 'embalse';

const SECTOR_BY_ID = new Map(SECTORS.map((s) => [s.id, s]));

/**
 * True when the sector is coastal (marine features apply). Single source of
 * truth derived from the `coastal` flag on the Sector config — replaces the
 * old hardcoded `sectorId === 'rias'` checks so new coastal sectors
 * (e.g. Coruña-Ferrol, Norte de Portugal) inherit all marine features.
 */
export function isCoastalSector(sectorId: string | null | undefined): boolean {
  return sectorId != null && (SECTOR_BY_ID.get(sectorId)?.coastal ?? false);
}
