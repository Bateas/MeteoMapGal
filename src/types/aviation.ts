/** Aviation aircraft tracking types */

export interface Aircraft {
  icao24: string;
  callsign: string;
  lat: number;
  lon: number;
  altitude: number; // meters (barometric)
  velocity: number; // m/s ground speed
  verticalRate: number; // m/s (negative = descending)
  heading: number; // degrees true
  onGround: boolean;
  distanceKm: number; // distance to sector center
  lastUpdate: number; // timestamp ms
}

export type AviationAlertLevel = 'none' | 'info' | 'moderate' | 'critical';

export interface AviationAlert {
  level: AviationAlertLevel;
  nearestAircraft: Aircraft | null;
  aircraftInBbox: number;
  aircraftClose: number; // < 3km
  updatedAt: number;
}

/** Embalse de Castrelo bounding box for OpenSky API (~15km around center) */
export const EMBALSE_BBOX = {
  lamin: 42.22,
  lomin: -8.18,
  lamax: 42.36,
  lomax: -7.98,
} as const;

/** Embalse center for distance calculations */
export const EMBALSE_CENTER = { lat: 42.29, lon: -8.1 } as const;
