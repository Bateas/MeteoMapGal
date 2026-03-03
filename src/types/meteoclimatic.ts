/** Raw Meteoclimatic XML station data (parsed from XML feed) */
export interface MeteoclimaticRawStation {
  id: string;           // e.g. "ESGAL3200000032003A"
  location: string;     // e.g. "Ourense - Centro"
  pubDate: string;      // ISO-ish date string
  qos: number;          // 0-3 quality score
  temperature: number | null;  // °C
  humidity: number | null;     // %
  pressure: number | null;     // hPa
  windSpeed: number | null;    // km/h (needs conversion to m/s)
  windAzimuth: number | null;  // degrees
  windGust: number | null;     // km/h
  rain: number | null;         // mm
}

/** Known Meteoclimatic station coordinates (not included in XML feed) */
export interface MeteoclimaticStationMeta {
  id: string;
  lat: number;
  lon: number;
  altitude: number;
}

/**
 * Hardcoded coordinates for Meteoclimatic stations (Ourense + Pontevedra nearby).
 * The XML feed doesn't include lat/lon, so we maintain a lookup table.
 * Stations from ESGAL32 (Ourense) and ESGAL36 (Pontevedra) feeds.
 */
export const METEOCLIMATIC_STATIONS: MeteoclimaticStationMeta[] = [
  // --- Ourense (ESGAL32) ---
  { id: 'ESGAL3200000032003A', lat: 42.333, lon: -7.850, altitude: 135 },   // Ourense - Centro
  { id: 'ESGAL3200000032005A', lat: 42.317, lon: -7.867, altitude: 136 },   // Ourense - CIFP A Farixa
  { id: 'ESGAL3200000032236A', lat: 42.133, lon: -8.183, altitude: 218 },   // A Notaria (Padrenda)
  { id: 'ESGAL3200000032548A', lat: 41.950, lon: -7.000, altitude: 977 },   // Cádavos - A Mezquita
  { id: 'ESGAL3200000032500A', lat: 42.417, lon: -8.067, altitude: 420 },   // O Carballiño - Señorín
  { id: 'ESGAL3200000032455A', lat: 42.383, lon: -8.083, altitude: 400 },   // San Amaro - Anllo
  // --- Pontevedra (ESGAL36) — nearby stations for frontal/gradient detection ---
  { id: 'ESGAL3600000036516A', lat: 42.515, lon: -8.155, altitude: 580 },   // O Sisto - Dozón
  { id: 'ESGAL3600000036516B', lat: 42.518, lon: -8.150, altitude: 575 },   // Barrio O Sisto
  { id: 'ESGAL3600000036110B', lat: 42.385, lon: -8.525, altitude: 380 },   // Campo Lameiro (A Lagoa)
  { id: 'ESGAL3600000036519A', lat: 42.660, lon: -8.130, altitude: 550 },   // Cristimil - Lalín
  { id: 'ESGAL3600000036538A', lat: 42.659, lon: -7.946, altitude: 640 },   // Rodeiro-Vilarmaior
];

/** Meteoclimatic feed regions to fetch */
export const METEOCLIMATIC_REGIONS = ['ESGAL32', 'ESGAL36'] as const;
