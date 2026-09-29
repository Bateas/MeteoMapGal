/**
 * Where the PUBLIC API says a private station is. A Netatmo, Weather Underground or
 * Meteoclimatic station sits at someone's home, and /api/v1/stations/list gave its position to
 * 13 decimals. Those networks publish it on their own maps, so this is good practice rather than
 * a secret kept: the answers the public API gives are rounded to 3 decimals, a cell of about
 * 111 x 82 m at this latitude, so the point shown is within some 70 m (typically 35) of the
 * station. Everything the server computes (scoring, calibration, alerts) reads the exact
 * position from the database; only what leaves through the API is rounded. For the map's own
 * scoring the shift is irrelevant: spot radii are 6-15 km.
 *
 * Official networks (MeteoGalicia, AEMET, IPMA), buoys and our own stations keep their exact
 * position: they are public infrastructure, not homes.
 */
export const PRIVATE_NETWORKS: ReadonlySet<string> = new Set(['netatmo', 'wunderground', 'meteoclimatic']);
export const PUBLIC_DECIMALS = 3;

const round = (x: number) => Math.round(x * 10 ** PUBLIC_DECIMALS) / 10 ** PUBLIC_DECIMALS;

export function publicLatLon(source: string | null | undefined, lat: number, lon: number): { lat: number; lon: number } {
  if (!source || !PRIVATE_NETWORKS.has(source) || !Number.isFinite(lat) || !Number.isFinite(lon)) return { lat, lon };
  return { lat: round(lat), lon: round(lon) };
}

/** A copy of each row with its position as the public API should give it. */
export function withPublicLocation<T extends { source: string | null; lat: number; lon: number }>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r, ...publicLatLon(r.source, Number(r.lat), Number(r.lon)) }));
}
