/**
 * Ground altitude from a digital elevation model, for stations whose network reports none.
 *
 * Wunderground and IPMA give no elevation, so ~170 stations sit at 0 m, which consumers have
 * to read as "unknown": the lapse rate drops them and the thermal precursor cannot place them.
 * The terrain tiles published on AWS (Terrarium encoding, public, no quota) give the ground
 * height at any point. Checked against 218 MeteoGalicia and AEMET stations with an official
 * altitude, at zoom 12 (~29 m per pixel here): median error 6 m, 90% within 16 m, the worst
 * 167 m on a steep mountainside (Casaio, 1,280 m).
 *
 * Pure functions only; the download and the database write live in demAltitudes.ts.
 */

export const DEM_ZOOM = 12;
export const DEM_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const TILE_PX = 256;

export interface TilePixel { x: number; y: number; px: number; py: number }

/** Web-mercator tile and pixel inside it for a point, at the given zoom. */
export function tilePixel(lat: number, lon: number, zoom = DEM_ZOOM): TilePixel {
  const n = 2 ** zoom;
  const xf = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  return { x, y, px: Math.min(TILE_PX - 1, Math.floor((xf - x) * TILE_PX)), py: Math.min(TILE_PX - 1, Math.floor((yf - y) * TILE_PX)) };
}

/** Height in metres encoded in a Terrarium pixel. */
export function terrariumMeters(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * The altitude to store for a station from the height under it. The tiles carry bathymetry,
 * so a shoreline station whose pixel falls on the water reads zero or below; it is at the
 * coast, and storing 1 m keeps it apart from the 0 that means "unknown". Rounded to the metre:
 * the model is not better than that.
 */
export function stationAltitudeFromDem(meters: number): number | null {
  if (!Number.isFinite(meters)) return null;
  return Math.max(1, Math.round(meters));
}
