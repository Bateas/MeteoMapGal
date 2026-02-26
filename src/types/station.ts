export interface NormalizedStation {
  id: string;
  source: 'aemet' | 'meteogalicia' | 'meteoclimatic' | 'wunderground' | 'netatmo';
  name: string;
  lat: number;
  lon: number;
  altitude: number;
  province?: string;
  municipality?: string;
}

export interface NormalizedReading {
  stationId: string;
  timestamp: Date;
  windSpeed: number | null;      // m/s
  windDirection: number | null;   // degrees (0-360, from north, meteorological convention)
  temperature: number | null;     // Celsius
  humidity: number | null;        // %
  precipitation: number | null;   // mm
}
