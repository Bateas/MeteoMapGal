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

/** Wide bounding box for OpenSky API — all of Galicia + N Portugal to catch airport traffic */
export const AVIATION_DISPLAY_BBOX = {
  lamin: 41.8,
  lomin: -9.3,
  lamax: 43.8,
  lomax: -7.0,
} as const;

/** Embalse center for distance/alert calculations */
export const EMBALSE_CENTER = { lat: 42.29, lon: -8.1 } as const;

/** Alert radius thresholds (km from Embalse center) */
export const ALERT_RADIUS = {
  display: 80,   // Show on map if within ~80km
  info: 15,      // INFO alert: aircraft within 15km
  moderate: 3,   // MODERATE: <3km + <500m + descending
  critical: 1,   // CRITICAL: <1km + <200m
} as const;
