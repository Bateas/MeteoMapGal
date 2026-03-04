export interface NormalizedStation {
  id: string;
  source: 'aemet' | 'meteogalicia' | 'meteoclimatic' | 'wunderground' | 'netatmo';
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
}
