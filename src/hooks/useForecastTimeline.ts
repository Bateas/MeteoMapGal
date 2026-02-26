import { useEffect, useRef, useCallback } from 'react';
import { create } from 'zustand';
import type { HourlyForecast, ForecastState } from '../types/forecast';
import { MAP_CENTER } from '../config/constants';

/** Reservoir center */
const LAT = MAP_CENTER[1]; // 42.29
const LON = MAP_CENTER[0]; // -8.1

/** Refresh forecast every 30 minutes */
const POLL_INTERVAL_MS = 30 * 60 * 1000;

/** Hours of forecast to fetch */
const FORECAST_HOURS = 48;
/** Hours of past data to include (for comparison) */
const PAST_HOURS = 6;

// ---------------------------------------------------------------------------
// Open-Meteo response shape (forecast-specific)
// ---------------------------------------------------------------------------

interface OMForecastResponse {
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    relative_humidity_2m: (number | null)[];
    wind_speed_10m: (number | null)[];
    wind_direction_10m: (number | null)[];
    wind_gusts_10m: (number | null)[];
    precipitation: (number | null)[];
    precipitation_probability: (number | null)[];
    cloud_cover: (number | null)[];
    surface_pressure: (number | null)[];
    shortwave_radiation: (number | null)[];
    cape: (number | null)[];
    is_day: (number | null)[];
  };
}

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

interface ForecastStore extends ForecastState {
  setHourly: (data: HourlyForecast[]) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  setFetchedAt: (d: Date) => void;
}

export const useForecastStore = create<ForecastStore>((set) => ({
  hourly: [],
  fetchedAt: null,
  isLoading: false,
  error: null,

  setHourly: (hourly) => set({ hourly }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setFetchedAt: (fetchedAt) => set({ fetchedAt }),
}));

// ---------------------------------------------------------------------------
// Fetch function
// ---------------------------------------------------------------------------

async function fetchForecastTimeline(): Promise<HourlyForecast[]> {
  const params = [
    'temperature_2m', 'relative_humidity_2m',
    'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
    'precipitation', 'precipitation_probability',
    'cloud_cover', 'surface_pressure',
    'shortwave_radiation', 'cape', 'is_day',
  ].join(',');

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${LAT}&longitude=${LON}` +
    `&hourly=${params}` +
    `&past_hours=${PAST_HOURS}` +
    `&forecast_hours=${FORECAST_HOURS}` +
    `&wind_speed_unit=ms` +
    `&timezone=Europe%2FMadrid`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo forecast: ${res.status}`);

  const data: OMForecastResponse = await res.json();
  const h = data.hourly;
  const result: HourlyForecast[] = [];

  for (let i = 0; i < h.time.length; i++) {
    result.push({
      time: new Date(h.time[i]),
      temperature: h.temperature_2m[i],
      humidity: h.relative_humidity_2m[i],
      windSpeed: h.wind_speed_10m[i],
      windDirection: h.wind_direction_10m[i],
      windGusts: h.wind_gusts_10m[i],
      precipitation: h.precipitation[i],
      precipProbability: h.precipitation_probability[i],
      cloudCover: h.cloud_cover[i],
      pressure: h.surface_pressure[i],
      solarRadiation: h.shortwave_radiation[i],
      cape: h.cape[i],
      isDay: h.is_day[i] === 1,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Hook: auto-polls forecast data
// ---------------------------------------------------------------------------

export function useForecastTimeline() {
  const { setHourly, setLoading, setError, setFetchedAt } = useForecastStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchForecastTimeline();
      setHourly(data);
      setError(null);
      setFetchedAt(new Date());
      console.log(`[Forecast] Loaded ${data.length}h timeline for reservoir`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error cargando previsión';
      setError(msg);
      console.error('[Forecast] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [setHourly, setLoading, setError, setFetchedAt]);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll]);
}
