/**
 * Which official warnings reach one point (a spot), not the whole sector.
 *
 * The sector lists keep every zone the sector touches, which is right for the map's warning band.
 * A spot's forecast is about one place: a warning for the north shore of Arousa, or for Viana do
 * Castelo, says nothing to Cesantes (18-nov: an IPMA rain warning for Viana sat on the Cesantes
 * forecast). So here a zone counts only when the point lies in it.
 *
 * The provinces are cut with coarse lines that are right for every spot we have; a zone we do not
 * know stays (better one warning too many than a real one missing).
 */
import type { MGWarning } from '../api/mgWarningsClient';
import type { IpmaWarning } from '../api/ipmaWarningsClient';
import { haversineDistance } from './geoUtils';

export interface Place { lat: number; lon: number }

// North shore of Arousa and Corrubedo are A Coruña; A Illa de Arousa and everything south is Pontevedra.
const inCoruna = (p: Place) => p.lat > 42.65 || (p.lat > 42.5 && p.lon < -8.93);
const inLugo = (p: Place) => p.lat > 42.5 && p.lon > -8.0;
const inPontevedra = (p: Place) => !inCoruna(p) && !inLugo(p) && p.lon < -8.2;
const inOurense = (p: Place) => !inLugo(p) && p.lat <= 42.5 && p.lon >= -8.2;

/** MeteoGalicia zone (lower case, as the feed names it) → is the point in it. */
const ZONE_REACH: Record<string, (p: Place) => boolean> = {
  'rías baixas (mar)': (p) => inPontevedra(p) || inCoruna(p),
  'litoral pontevedra': inPontevedra,
  'pontevedra (provincia)': inPontevedra,
  'interior de pontevedra': inPontevedra,
  'miño de pontevedra': inPontevedra,
  'suroeste de a coruña': inCoruna,
  'noroeste de ourense': inOurense,
  'sur de ourense': inOurense,
  'ourense (provincia)': inOurense,
  'sur de lugo': inLugo,
};

export function zoneReaches(zoneName: string, p: Place): boolean {
  const f = ZONE_REACH[zoneName.trim().toLowerCase()];
  return f ? f(p) : true;
}

/** The warnings with only the zones the point lies in; a warning left without zones goes. */
export function mgWarningsAt(warnings: MGWarning[], p: Place | null | undefined): MGWarning[] {
  if (!p) return warnings;
  const out: MGWarning[] = [];
  for (const w of warnings) {
    const zones = w.zones.filter((z) => zoneReaches(z.name, p));
    if (zones.length === 0) continue;
    out.push(zones.length === w.zones.length ? w : { ...w, zones, maxLevel: Math.max(...zones.map((z) => z.level)) });
  }
  return out;
}

/** The Portuguese border, Miño mouth to the east of Verín: an IPMA district warning reaches a spot only near it. */
const BORDER: [number, number][] = [
  [41.87, -8.87], [42.04, -8.65], [42.08, -8.50], [42.11, -8.31], [42.15, -8.17],
  [41.87, -8.20], [41.81, -8.12], [41.92, -7.92], [41.88, -7.45], [41.92, -7.20],
];
export const IPMA_REACH_KM = 15;

/** Distance (km) from the point to the border line, by its vertices and the points between them. */
export function kmToBorder(p: Place): number {
  let best = Infinity;
  for (let i = 0; i + 1 < BORDER.length; i++) {
    const [a, b] = [BORDER[i], BORDER[i + 1]];
    for (let k = 0; k <= 10; k++) {
      const lat = a[0] + (b[0] - a[0]) * (k / 10), lon = a[1] + (b[1] - a[1]) * (k / 10);
      best = Math.min(best, haversineDistance(p.lat, p.lon, lat, lon));
    }
  }
  return best;
}

export function ipmaWarningsAt(warnings: IpmaWarning[], p: Place | null | undefined): IpmaWarning[] {
  if (!p) return warnings;
  return kmToBorder(p) <= IPMA_REACH_KM ? warnings : [];
}
