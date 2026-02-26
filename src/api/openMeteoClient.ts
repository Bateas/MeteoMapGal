import type { NormalizedReading } from '../types/station';

interface OpenMeteoHourlyResponse {
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    relative_humidity_2m: (number | null)[];
    wind_speed_10m: (number | null)[];
    wind_direction_10m: (number | null)[];
  };
}

/**
 * Fetch 24h historical hourly data from Open-Meteo for a given location.
 * Open-Meteo is free, no API key, no CORS restrictions.
 * Returns model/reanalysis data (not station observations).
 * Wind speed is requested in m/s to match our internal units.
 */
export async function fetchOpenMeteoHistory(
  lat: number,
  lon: number,
  stationId: string,
  pastHours = 24
): Promise<NormalizedReading[]> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&past_hours=${pastHours}&forecast_hours=0&wind_speed_unit=ms`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[OpenMeteo] Failed for ${stationId}: ${res.status}`);
    return [];
  }

  const data: OpenMeteoHourlyResponse = await res.json();
  const readings: NormalizedReading[] = [];

  for (let i = 0; i < data.hourly.time.length; i++) {
    readings.push({
      stationId,
      timestamp: new Date(data.hourly.time[i] + 'Z'), // UTC
      windSpeed: data.hourly.wind_speed_10m[i],
      windDirection: data.hourly.wind_direction_10m[i],
      temperature: data.hourly.temperature_2m[i],
      humidity: data.hourly.relative_humidity_2m[i],
      precipitation: null,
    });
  }

  return readings;
}

/**
 * Fetch 24h history for multiple stations in parallel.
 * Uses station coordinates to query Open-Meteo grid data.
 */
export async function fetchOpenMeteoForStations(
  stations: { id: string; lat: number; lon: number }[],
  pastHours = 24
): Promise<NormalizedReading[]> {
  const results = await Promise.allSettled(
    stations.map((s) => fetchOpenMeteoHistory(s.lat, s.lon, s.id, pastHours))
  );

  const allReadings: NormalizedReading[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allReadings.push(...result.value);
    }
  }

  console.log(`[OpenMeteo] Loaded ${allReadings.length} historical readings for ${stations.length} stations`);
  return allReadings;
}
