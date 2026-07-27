/**
 * Naming where a fire is, instead of measuring it from a reservoir.
 *
 * A satellite hotspot only carries coordinates, so the first version of the
 * popup described one as "125 km south of Embalse de Castrelo". That is
 * technically true and practically useless: 125 km south of a Galician
 * reservoir is Portugal, and nobody thinks of Porto as a suburb of Castrelo.
 *
 * These are coarse boxes, on purpose. There is no geocoding service here and
 * one is not wanted: a box that says "northern Portugal" is honest at the
 * precision we actually have, whereas a street-level name would imply we know
 * more about a 375 m pixel than we do. Order matters — the first box that
 * contains the point wins, so Galicia is tested before the wider neighbours.
 */

export interface FireRegion {
  /** Where it is, ready to drop into a sentence: "en Ourense", "en el norte de Portugal" */
  label: string;
  /** True for the four Galician provinces — the only ones we claim as "here" */
  inGalicia: boolean;
}

interface RegionBox {
  label: string;
  inGalicia: boolean;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/**
 * Rough provincial extents, generous at the edges. A hotspot on a boundary can
 * fall in either neighbour; that costs a slightly wrong province name, never a
 * wrong claim about distance or intensity.
 */
const REGIONS: RegionBox[] = [
  // ── Galicia, tested first ──
  { label: 'A Coruña', inGalicia: true, minLat: 42.75, maxLat: 43.8, minLon: -9.35, maxLon: -7.85 },
  { label: 'Lugo', inGalicia: true, minLat: 42.35, maxLat: 43.8, minLon: -7.85, maxLon: -6.75 },
  { label: 'Pontevedra', inGalicia: true, minLat: 41.85, maxLat: 42.95, minLon: -9.05, maxLon: -8.05 },
  { label: 'Ourense', inGalicia: true, minLat: 41.8, maxLat: 42.6, minLon: -8.35, maxLon: -6.75 },

  // ── Neighbours: named by region, not by province, because that is the
  //    resolution at which the name still means something to a reader here ──
  { label: 'el norte de Portugal', inGalicia: false, minLat: 40.6, maxLat: 42.0, minLon: -9.0, maxLon: -6.2 },
  { label: 'Zamora / León', inGalicia: false, minLat: 41.6, maxLat: 43.0, minLon: -6.75, maxLon: -5.4 },
  { label: 'Asturias', inGalicia: false, minLat: 43.0, maxLat: 43.8, minLon: -6.75, maxLon: -4.5 },
];

/**
 * Name the region a fire sits in, or null when it falls outside every box —
 * in which case the caller should fall back to distance and bearing rather
 * than invent a place.
 */
export function fireRegion(lat: number, lon: number): FireRegion | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const r of REGIONS) {
    if (lat >= r.minLat && lat <= r.maxLat && lon >= r.minLon && lon <= r.maxLon) {
      return { label: r.label, inGalicia: r.inGalicia };
    }
  }
  return null;
}

/**
 * Above this radiative power, calling something "possibly an agricultural
 * burn" stops being caution and becomes a wrong statement: a stubble fire
 * does not radiate hundreds of megawatts. Galician authorised burns sit in
 * the single digits to low tens.
 */
export const BURN_PLAUSIBLE_MAX_MW = 25;

/**
 * The disclaimer, scaled to what the number can actually mean.
 *
 * Both branches keep the same promise — this is a satellite detection, not a
 * confirmed and named incident — but only the small one entertains a burn.
 */
export function fireDisclaimer(frpMw: number): string {
  if (!Number.isFinite(frpMw) || frpMw <= 0 || frpMw < BURN_PLAUSIBLE_MAX_MW) {
    return 'Detección por satélite. Puede ser un incendio, una quema autorizada o un fuego agrícola.';
  }
  return 'Detección por satélite, sin confirmación oficial. Por su intensidad no es una quema agrícola.';
}

/**
 * One line placing the fire: region when we can name it, distance and bearing
 * as the fallback. The distance still travels alongside the name because
 * "how far from me" is the part that changes what the reader does.
 */
export function describeFireLocation(
  lat: number,
  lon: number,
  distanceKm: number,
  bearing: string,
): string {
  const km = Math.round(distanceKm);
  const region = fireRegion(lat, lon);
  if (region) return `En ${region.label}, a ${km} km`;
  return `A ${km} km al ${bearing}`;
}
