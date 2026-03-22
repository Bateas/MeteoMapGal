import { useCallback } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { HourlyForecast, ForecastState, ForecastModel } from '../types/forecast';
import { MAP_CENTER } from '../config/constants';
import { useVisibilityPolling } from './useVisibilityPolling';
import { useSectorStore } from '../store/sectorStore';
import { openMeteoFetch } from '../api/openMeteoQueue';

/** Sector-specific forecast coordinates */
const SECTOR_COORDS: Record<string, [number, number]> = {
  embalse: [MAP_CENTER[1], MAP_CENTER[0]],  // 42.29, -8.1
  rias: [42.307, -8.619],                    // Cesantes center (inner ría)
};

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
    boundary_layer_height: (number | null)[];
    is_day: (number | null)[];
    visibility: (number | null)[];
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
  setActiveModel: (m: ForecastModel) => void;
}

export const useForecastStore = create<ForecastStore>((set) => ({
  hourly: [],
  fetchedAt: null,
  isLoading: false,
  error: null,
  activeModel: 'best_match',

  setHourly: (hourly) => set({ hourly }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setFetchedAt: (fetchedAt) => set({ fetchedAt }),
  setActiveModel: (activeModel) => set({ activeModel, hourly: [], fetchedAt: null }),
}));

// ---------------------------------------------------------------------------
// Fetch function
// ---------------------------------------------------------------------------

async function fetchForecastTimeline(model: ForecastModel = 'best_match', lat = 42.29, lon = -8.1): Promise<HourlyForecast[]> {
  const params = [
    'temperature_2m', 'relative_humidity_2m',
    'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
    'precipitation', 'precipitation_probability',
    'cloud_cover', 'surface_pressure',
    'shortwave_radiation', 'cape', 'boundary_layer_height', 'is_day', 'visibility',
  ].join(',');

  const modelParam = model !== 'best_match' ? `&models=${model}` : '';
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=${params}` +
    `&past_hours=${PAST_HOURS}` +
    `&forecast_hours=${FORECAST_HOURS}` +
    `&wind_speed_unit=ms` +
    `&timezone=Europe%2FMadrid` +
    modelParam;

  const res = await openMeteoFetch(url, undefined, 15_000);
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
      boundaryLayerHeight: h.boundary_layer_height[i],
      visibility: h.visibility[i],
      isDay: h.is_day[i] === 1,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Hook: auto-polls forecast data
// ---------------------------------------------------------------------------

export function useForecastTimeline() {
  const { setHourly, setLoading, setError, setFetchedAt, activeModel } = useForecastStore(
    useShallow((s) => ({
      setHourly: s.setHourly,
      setLoading: s.setLoading,
      setError: s.setError,
      setFetchedAt: s.setFetchedAt,
      activeModel: s.activeModel,
    })),
  );

  // Fetch forecast for both sectors using sector-specific coordinates
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const coords = SECTOR_COORDS[sectorId] ?? SECTOR_COORDS.embalse;

  const poll = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchForecastTimeline(activeModel, coords[0], coords[1]);
      setHourly(data);
      setError(null);
      setFetchedAt(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error cargando previsión';
      setError(msg);
      console.error('[Forecast] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [sectorId, activeModel, coords, setHourly, setLoading, setError, setFetchedAt]);

  // Visibility-aware polling — pauses when tab is hidden
  useVisibilityPolling(poll, POLL_INTERVAL_MS);
}
