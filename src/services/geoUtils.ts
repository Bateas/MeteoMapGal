const EARTH_RADIUS_KM = 6371;

/** Haversine distance in km between two lat/lon points */
export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Convert AEMET DMS coordinate string to decimal degrees.
 * AEMET format: "DDMMSSN" or "DDDMMSSO"
 * Examples: "421730N" → 42.2917, "080745W" → -8.1292
 */
export function aemetDmsToDecimal(dms: string): number {
  const cardinal = dms.slice(-1);
  const numPart = dms.slice(0, -1);

  let degrees: number;
  let minutes: number;
  let seconds: number;

  if (cardinal === 'N' || cardinal === 'S') {
    // Latitude: DDMMSS
    degrees = parseInt(numPart.slice(0, 2), 10);
    minutes = parseInt(numPart.slice(2, 4), 10);
    seconds = parseInt(numPart.slice(4, 6), 10);
  } else {
    // Longitude: DDDMMSS (can be 2 or 3 digit degrees)
    if (numPart.length === 7) {
      degrees = parseInt(numPart.slice(0, 3), 10);
      minutes = parseInt(numPart.slice(3, 5), 10);
      seconds = parseInt(numPart.slice(5, 7), 10);
    } else {
      degrees = parseInt(numPart.slice(0, 2), 10);
      minutes = parseInt(numPart.slice(2, 4), 10);
      seconds = parseInt(numPart.slice(4, 6), 10);
    }
  }

  let decimal = degrees + minutes / 60 + seconds / 3600;
  if (cardinal === 'S' || cardinal === 'W') {
    decimal = -decimal;
  }
  return decimal;
}

/** Check if a point is within radius km from center */
export function isWithinRadius(
  centerLat: number, centerLon: number,
  pointLat: number, pointLon: number,
  radiusKm: number
): boolean {
  return haversineDistance(centerLat, centerLon, pointLat, pointLon) <= radiusKm;
}
