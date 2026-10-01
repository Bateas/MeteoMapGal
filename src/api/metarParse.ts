/**
 * METAR visibility, from the aviationweather.gov `visib` field to km. Pure and with no import,
 * so the map client (metarClient.ts) and the ingestor's METAR archive share it without the
 * ingestor reaching the map's store.
 */

const SM_TO_KM = 1.609;
/** Same sanity ceiling as the AEMET visibility writer (km). */
const MAX_VISIBILITY_KM = 50;
/** "N+" and the rawOb 9999 group both mean "10km or more" — report the cap. */
const VISIBILITY_CAP_KM = 10;

/** Round to 1 decimal; reject negatives and sensor nonsense above the cap. */
function sanitizeKm(km: number): number | null {
  if (!Number.isFinite(km) || km < 0 || km > MAX_VISIBILITY_KM) return null;
  return Math.round(km * 10) / 10;
}

/**
 * Convert the METAR `visib` field to km, or null when it cannot be trusted.
 *
 * Precedence: an explicit `visib` always wins (even to discard the station
 * when it is garbage); the rawOb " 9999 " fallback applies ONLY when `visib`
 * is absent or empty. Never inventing a value is the whole point — these
 * readings outrank the model in every multi-evidence rule they feed.
 */
export function parseMetarVisibilityKm(
  visib: string | number | undefined | null,
  rawOb?: string,
): number | null {
  if (typeof visib === 'number' && Number.isFinite(visib)) {
    return sanitizeKm(visib * SM_TO_KM);
  }
  if (typeof visib === 'string' && visib.trim() !== '') {
    const trimmed = visib.trim();
    // "6+" = at or above the 10km ICAO reporting ceiling
    if (/^\d+(\.\d+)?\+$/.test(trimmed)) return VISIBILITY_CAP_KM;
    const sm = Number(trimmed);
    if (Number.isFinite(sm) && sm >= 0) return sanitizeKm(sm * SM_TO_KM);
    return null; // present but unparseable → discard, do not fall back
  }
  // No visib reported — the raw METAR 9999 group still certifies >=10km
  if (typeof rawOb === 'string' && rawOb.includes(' 9999 ')) return VISIBILITY_CAP_KM;
  return null;
}
