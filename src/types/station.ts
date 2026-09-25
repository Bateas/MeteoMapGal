export type StationSource = 'aemet' | 'meteogalicia' | 'meteoclimatic' | 'wunderground' | 'netatmo' | 'skyx' | 'ipma';

export interface NormalizedStation {
  id: string;
  source: StationSource;
  name: string;
  lat: number;
  lon: number;
  altitude: number;
  province?: string;
  municipality?: string;
  /** Station has only temperature/humidity sensors (no wind).
   *  Shown as small dot on map, not selectable, but feeds thermal scoring. */
  tempOnly?: boolean;
}

export interface NormalizedReading {
  stationId: string;
  timestamp: Date;
  windSpeed: number | null;      // m/s
  windGust: number | null;       // m/s (peak gust, when available)
  windDirection: number | null;   // degrees (0-360, from north, meteorological convention)
  temperature: number | null;     // Celsius
  humidity: number | null;        // %
  precipitation: number | null;   // mm
  solarRadiation: number | null;  // W/m² — global shortwave (pyranometer or PWS sensor)
  pressure: number | null;        // hPa — station-level atmospheric pressure
  dewPoint: number | null;        // °C — dew point temperature (measured or from API)
  visibility?: number | null;     // km — horizontal visibility (AEMET airports only; <1km = fog ICAO)
  // Stored for analysis; no surface reads them yet. Only MeteoGalicia and AEMET send them.
  windDirSd?: number | null;      // ° — std deviation of wind direction over the averaging period
  windSpeedSd?: number | null;    // m/s — std deviation of wind speed over the averaging period
  sunFrac?: number | null;        // 0..1 — share of the period with sun (MG 10 min, AEMET 1 h)
  temp10cm?: number | null;       // °C — air 10 cm above ground (MeteoGalicia only)
  soilTemp?: number | null;       // °C — soil 10 cm deep (MeteoGalicia only)
}
