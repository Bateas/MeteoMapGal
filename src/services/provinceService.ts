/**
 * Which Galician province a station sits in.
 *
 * Three of the six sources tell us outright — MeteoGalicia and AEMET carry a
 * `provincia` field, and a Meteoclimatic id spells it out in its prefix — but
 * each writes it differently ("A CORUÑA", "A Coruña", "Coruna"), so the first
 * job here is agreeing on one spelling.
 *
 * Wunderground and Netatmo say nothing, and they are now most of the network.
 * For those the province is inherited from the nearest station that DOES know,
 * which beats drawing boxes on a map: measured leave-one-out against the 155
 * MeteoGalicia stations, the nearest-neighbour rule gets 96.8% right where
 * hand-drawn rectangles managed 87.7%. Galician provincial borders are too
 * ragged for rectangles — Deza reaches east into what looks like Ourense, and
 * the Rodeiro corner pushes into what looks like Lugo.
 *
 * This is for looking at coverage, not for deciding anything: no verdict, no
 * alert and no scoring reads it. A station near a border being filed one
 * province over costs nothing.
 */

export type Province = 'A Coruña' | 'Lugo' | 'Ourense' | 'Pontevedra';

export const PROVINCES: Province[] = ['A Coruña', 'Lugo', 'Ourense', 'Pontevedra'];

/** Strip accents and case so "A CORUÑA", "A Coruna" and "Coruña" all meet. */
function fold(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

/** Canonical spelling for whatever a source calls a province, or null if it is
 *  not one of the four (AEMET covers all of Spain, so this rejects plenty). */
export function normalizeProvinceName(raw: string | null | undefined): Province | null {
  if (!raw) return null;
  const f = fold(raw);
  if (f.includes('CORUNA')) return 'A Coruña';
  if (f.includes('LUGO')) return 'Lugo';
  if (f.includes('OURENSE') || f.includes('ORENSE')) return 'Ourense';
  if (f.includes('PONTEVEDRA')) return 'Pontevedra';
  return null;
}

/** A Meteoclimatic id spells the province in its prefix: ESGAL + INE code.
 *  The old two-province version of this returned 'DESCONOCIDA' for A Coruña
 *  and Lugo, which went unnoticed while those feeds were never requested. */
export function provinceFromMeteoclimaticId(stationId: string): Province | null {
  const id = stationId.replace(/^mc_/, '');
  if (id.startsWith('ESGAL15')) return 'A Coruña';
  if (id.startsWith('ESGAL27')) return 'Lugo';
  if (id.startsWith('ESGAL32')) return 'Ourense';
  if (id.startsWith('ESGAL36')) return 'Pontevedra';
  return null;
}

export interface LabelledPoint {
  lat: number;
  lon: number;
  province: Province;
}

/** Rough distance, good enough for ranking neighbours a few km apart.
 *  Longitude is squeezed by the cosine of the latitude so the comparison is
 *  not skewed north-south; no need for the full great-circle here. */
function roughDistance(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = aLat - bLat;
  const dLon = (aLon - bLon) * Math.cos((aLat * Math.PI) / 180);
  return dLat * dLat + dLon * dLon;
}

/** Province of the nearest station that knows its own, or null with nothing to
 *  go on. Used for the sources that carry no province of their own. */
export function inferProvinceFromNeighbours(
  lat: number,
  lon: number,
  labelled: LabelledPoint[],
): Province | null {
  let best: Province | null = null;
  let bestDist = Infinity;
  for (const p of labelled) {
    const d = roughDistance(lat, lon, p.lat, p.lon);
    if (d < bestDist) {
      bestDist = d;
      best = p.province;
    }
  }
  return best;
}

/** Fill in the province of every station that lacks one, using those that have
 *  it as the reference set. Mutates in place and reports what it managed.
 *
 *  Stations with no usable coordinates are left alone rather than guessed at:
 *  a (0,0) placeholder would otherwise inherit whatever province happens to
 *  sit closest to the Gulf of Guinea. */
export function fillMissingProvinces(
  stations: { lat: number; lon: number; province?: string }[],
): { labelled: number; inferred: number; unknown: number } {
  const reference: LabelledPoint[] = [];
  for (const s of stations) {
    const known = normalizeProvinceName(s.province);
    if (known && Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.lat !== 0) {
      s.province = known;
      reference.push({ lat: s.lat, lon: s.lon, province: known });
    }
  }

  let inferred = 0;
  let unknown = 0;
  for (const s of stations) {
    if (normalizeProvinceName(s.province)) continue;
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon) || s.lat === 0) {
      s.province = undefined;
      unknown++;
      continue;
    }
    const guess = inferProvinceFromNeighbours(s.lat, s.lon, reference);
    if (guess) {
      s.province = guess;
      inferred++;
    } else {
      s.province = undefined;
      unknown++;
    }
  }

  return { labelled: reference.length, inferred, unknown };
}
