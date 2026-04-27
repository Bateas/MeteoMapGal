/**
 * Active fire / wildfire hotspot type — derived from NASA FIRMS VIIRS feed.
 *
 * One row per pixel detection. A real wildfire usually clusters several rows
 * within a few hundred metres (375m VIIRS pixel resolution).
 */

export type FireConfidence = 'low' | 'nominal' | 'high';

export interface ActiveFire {
  /** Stable composite ID: lat,lon,acquisition timestamp */
  id: string;
  lat: number;
  lon: number;
  /** Brightness temperature, channel I-4 (Kelvin). Higher = hotter pixel */
  brightness: number;
  /** Fire Radiative Power in megawatts. Proxy for fire intensity */
  frp: number;
  /** Acquisition time, parsed to Date object (UTC) */
  acquiredAt: Date;
  /** Satellite identifier (e.g. "N" for SNPP, "1" for NOAA20) */
  satellite: string;
  /** VIIRS confidence: low / nominal / high */
  confidence: FireConfidence;
  /** Day or night detection */
  daynight: 'D' | 'N';
}
