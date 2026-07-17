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
  /** Satellite identifier as FIRMS reports it: "N" = S-NPP, "N20" = NOAA-20 */
  satellite: string;
  /** VIIRS confidence: low / nominal / high */
  confidence: FireConfidence;
  /** Day or night detection */
  daynight: 'D' | 'N';
}

/**
 * A fire plus the lightning that may have started it.
 *
 * Served by `/api/v1/fires`, which crosses stored hotspots with our own
 * cloud-to-ground strike history: strikes within ~3km in the 72h before the
 * satellite saw the fire. Validated against the June 2026 outbreak — every one
 * of the 106 hotspots on 25-jun had strikes in that window, while a heavy
 * storm day with 12 hotspots (5-jul) had none attributable, so this reads fire
 * by fire rather than flagging any stormy day.
 */
export interface FireWithAttribution {
  time: string;
  lat: number;
  lon: number;
  satellite: string;
  frp: number | null;
  confidence: string | null;
  daynight: string | null;
  /** Attributed strikes; 0 means no lightning origin found */
  strikeCount: number;
  /** Hours from the strike to the fire being seen. Measured 7-18h typically:
   *  lightning smoulders in the humus long before it shows from orbit. */
  hoursAfterStrike: number | null;
  nearestStrikeKm: number | null;
  /** Strongest strike involved (kA) — the incendiary ones run high */
  maxStrikeKa: number | null;
}
