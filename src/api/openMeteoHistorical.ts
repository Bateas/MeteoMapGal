/**
 * Open-Meteo Archive API client for historical weather data.
 * Uses a different endpoint than the forecast API.
 * Free, no API key, no CORS restrictions.
 *
 * Archive API: https://archive-api.open-meteo.com/v1/archive
 */

export interface HourlyDataPoint {
  time: Date;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;    // m/s
  windDirection: number | null; // degrees
}

interface ArchiveResponse {
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    relative_humidity_2m: (number | null)[];
    wind_speed_10m: (number | null)[];
    wind_direction_10m: (number | null)[];
  };
}

/**
 * Fetch historical hourly weather data from Open-Meteo Archive API.
 * @param lat Latitude
 * @param lon Longitude
 * @param startDate ISO date string (YYYY-MM-DD)
 * @param endDate ISO date string (YYYY-MM-DD)
 */
export async function fetchHistoricalData(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<HourlyDataPoint[]> {
  const url = `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lat}&longitude=${lon}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=ms` +
    `&timezone=Europe%2FMadrid`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo Archive API error: ${res.status} ${res.statusText}`);
  }

  const data: ArchiveResponse = await res.json();
  const points: HourlyDataPoint[] = [];

  for (let i = 0; i < data.hourly.time.length; i++) {
    points.push({
      time: new Date(data.hourly.time[i]),
      temperature: data.hourly.temperature_2m[i],
      humidity: data.hourly.relative_humidity_2m[i],
      windSpeed: data.hourly.wind_speed_10m[i],
      windDirection: data.hourly.wind_direction_10m[i],
    });
  }

  return points;
}

/**
 * Fetch historical data for multiple locations in parallel.
 * Useful for comparing zones.
 */
export async function fetchHistoricalMultiLocation(
  locations: { id: string; lat: number; lon: number }[],
  startDate: string,
  endDate: string
): Promise<Map<string, HourlyDataPoint[]>> {
  const results = new Map<string, HourlyDataPoint[]>();

  const settled = await Promise.allSettled(
    locations.map(async (loc) => {
      const data = await fetchHistoricalData(loc.lat, loc.lon, startDate, endDate);
      return { id: loc.id, data };
    })
  );

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.set(result.value.id, result.value.data);
    }
  }

  return results;
}
