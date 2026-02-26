import type { NormalizedReading } from '../types/station';
import type { ForecastPoint, MicroZoneId } from '../types/thermal';
import type { MicroZone } from '../types/thermal';

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

// ── Forecast functions ─────────────────────────────────

/**
 * Fetch hourly forecast from Open-Meteo for a location.
 * Uses the same API but with forecast_hours instead of past_hours.
 */
export async function fetchOpenMeteoForecast(
  lat: number,
  lon: number,
  forecastHours = 12
): Promise<ForecastPoint[]> {
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m` +
    `&forecast_hours=${forecastHours}&past_hours=0` +
    `&wind_speed_unit=ms` +
    `&timezone=Europe%2FMadrid`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[OpenMeteo Forecast] Failed: ${res.status}`);
    return [];
  }

  const data: OpenMeteoHourlyResponse = await res.json();
  const points: ForecastPoint[] = [];

  for (let i = 0; i < data.hourly.time.length; i++) {
    points.push({
      timestamp: new Date(data.hourly.time[i]),
      temperature: data.hourly.temperature_2m[i],
      humidity: data.hourly.relative_humidity_2m[i],
      windSpeed: data.hourly.wind_speed_10m[i],
      windDirection: data.hourly.wind_direction_10m[i],
    });
  }

  return points;
}

/**
 * Fetch forecast data for all micro-zones in parallel.
 * Uses zone center coordinates.
 */
export async function fetchForecastForZones(
  zones: MicroZone[],
  forecastHours = 12
): Promise<Map<MicroZoneId, ForecastPoint[]>> {
  const results = new Map<MicroZoneId, ForecastPoint[]>();

  const settled = await Promise.allSettled(
    zones.map(async (zone) => {
      const data = await fetchOpenMeteoForecast(
        zone.center.lat, zone.center.lon, forecastHours
      );
      return { id: zone.id, data };
    })
  );

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.set(result.value.id, result.value.data);
    }
  }

  console.log(`[OpenMeteo Forecast] Loaded forecasts for ${results.size}/${zones.length} zones`);
  return results;
}
