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
 * Hardcoded coordinates for Ourense-area Meteoclimatic stations.
 * The XML feed doesn't include lat/lon, so we maintain a lookup table.
 */
export const METEOCLIMATIC_STATIONS: MeteoclimaticStationMeta[] = [
  { id: 'ESGAL3200000032003A', lat: 42.333, lon: -7.850, altitude: 135 },   // Ourense - Centro
  { id: 'ESGAL3200000032005A', lat: 42.317, lon: -7.867, altitude: 136 },   // Ourense - CIFP A Farixa
  { id: 'ESGAL3200000032236A', lat: 42.133, lon: -8.183, altitude: 218 },   // A Notaria (Padrenda)
  { id: 'ESGAL3200000032548A', lat: 41.950, lon: -7.000, altitude: 977 },   // Cádavos - A Mezquita
  { id: 'ESGAL3200000032870A', lat: 41.883, lon: -8.083, altitude: 487 },   // Cimadevila - Lobios
  { id: 'ESGAL3200000032500A', lat: 42.417, lon: -8.067, altitude: 420 },   // O Carballiño - Señorín
  { id: 'ESGAL3200000032455A', lat: 42.383, lon: -8.083, altitude: 400 },   // San Amaro - Anllo
];
