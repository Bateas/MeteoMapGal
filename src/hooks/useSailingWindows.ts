/**
 * Best Sailing Windows hook — fetches forecast and computes per-spot windows.
 *
 * - Embalse: reuses forecast data from useForecastStore (no extra fetch)
 * - Rías: fetches Open-Meteo at sector center [-8.68, 42.30]
 * - Polls every 30 min with visibility-aware polling
 * - Stores results in spotStore.sailingWindows
 */

import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSectorStore } from '../store/sectorStore';
import { useSpotStore } from '../store/spotStore';
import { useForecastStore } from './useForecastTimeline';
import { useThermalStore } from '../store/thermalStore';
import { useVisibilityPolling } from './useVisibilityPolling';
import { openMeteoFetch } from '../api/openMeteoQueue';
import { getSpotsForSector } from '../config/spots';
import { computeSpotWindows } from '../services/sailingWindowService';
import type { HourlyForecast } from '../types/forecast';
import type { SpotWindowResult } from '../services/sailingWindowService';

/** Rías Baixas sector center (from sectors.ts) */
const RIAS_LAT = 42.30;
const RIAS_LON = -8.68;

/** Poll every 30 min */
const POLL_INTERVAL_MS = 30 * 60_000;

/** Cooldown after 429 error — skip polls for 5 min */
let rateLimitedUntil = 0;

/** Forecast hours to fetch */
const FORECAST_HOURS = 48;

// ── Open-Meteo fetch for Rías ────────────────────────────────

async function fetchRiasForecast(): Promise<HourlyForecast[]> {
  const params = [
    'temperature_2m', 'relative_humidity_2m',
    'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
    'precipitation', 'precipitation_probability',
    'cloud_cover', 'surface_pressure',
    'shortwave_radiation', 'cape', 'boundary_layer_height', 'is_day', 'visibility',
  ].join(',');

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${RIAS_LAT}&longitude=${RIAS_LON}` +
    `&hourly=${params}` +
    `&forecast_hours=${FORECAST_HOURS}` +
    `&wind_speed_unit=ms` +
    `&timezone=Europe%2FMadrid`;

  const res = await openMeteoFetch(url, undefined, 25_000);
  if (!res.ok) throw new Error(`Open-Meteo sailing windows: ${res.status}`);

  const data = await res.json();
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

// ── Hook ─────────────────────────────────────────────────────

export function useSailingWindows() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const setSailingWindows = useSpotStore((s) => s.setSailingWindows);
  const setSectorForecast = useSpotStore((s) => s.setSectorForecast);

  const embalseHourly = useForecastStore((s) => s.hourly);
  const thermalRules = useThermalStore((s) => s.rules);

  const poll = useCallback(async () => {
    // Skip if rate-limited recently
    if (Date.now() < rateLimitedUntil) return;

    try {
      let forecast: HourlyForecast[];

      if (sectorId === 'embalse') {
        // Reuse existing forecast data from useForecastTimeline
        if (embalseHourly.length > 0) {
          forecast = embalseHourly;
        } else {
          // Forecast not yet loaded — skip this cycle, will run again in 30min
          return;
        }
      } else {
        // Rías — fetch own forecast
        forecast = await fetchRiasForecast();
      }

      const spots = getSpotsForSector(sectorId);
      const windows = new Map<string, SpotWindowResult>();

      for (const spot of spots) {
        const rules = spot.thermalDetection ? thermalRules : undefined;
        const result = computeSpotWindows(forecast, spot, rules);
        windows.set(spot.id, result);
      }

      setSailingWindows(windows);
      setSectorForecast(forecast);

      const totalWindows = Array.from(windows.values()).reduce((s, w) => s + w.windows.length, 0);
      console.log(`[SailingWindows] Computed ${totalWindows} windows for ${spots.length} spots`);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('429')) {
        rateLimitedUntil = Date.now() + 5 * 60_000; // 5 min cooldown
        console.warn('[SailingWindows] Rate limited, cooldown 5min');
      } else {
        console.error('[SailingWindows] Error:', err);
      }
    }
  }, [sectorId, embalseHourly, thermalRules, setSailingWindows, setSectorForecast]);

  // Defer first load to let critical data (stations, forecast) load first
  const deferredPoll = useCallback(async () => {
    const windowsFetched = useSpotStore.getState().windowsFetchedAt;
    if (windowsFetched === 0) {
      // First run — wait 10s to avoid competing with startup burst
      await new Promise(r => setTimeout(r, 10_000));
    }
    return poll();
  }, [poll]);

  useVisibilityPolling(deferredPoll, POLL_INTERVAL_MS);
}
