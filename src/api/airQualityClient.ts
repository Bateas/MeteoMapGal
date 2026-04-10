/**
 * Open-Meteo Air Quality API client.
 *
 * Fetches UV index, PM2.5, PM10, European AQI, and pollen counts.
 * Zone-based (sector center), NOT spot-specific.
 * Uses openMeteoQueue for rate limiting.
 *
 * Endpoint: https://air-quality-api.open-meteo.com/v1/air-quality
 * No API key. No CORS restrictions. Free tier.
 */

import { openMeteoFetch } from './openMeteoQueue';

export interface AirQualityData {
  timestamp: Date;
  uvIndex: number | null;
  uvIndexClearSky: number | null;
  pm2_5: number | null;           // µg/m³
  pm10: number | null;            // µg/m³
  europeanAqi: number | null;     // 0-500
  ozone: number | null;           // µg/m³
  nitrogenDioxide: number | null; // µg/m³
  grassPollen: number | null;     // grains/m³
  olivePollen: number | null;     // grains/m³
  birchPollen: number | null;     // grains/m³
}

export interface AirQualityCurrent {
  uvIndex: number;
  pm2_5: number;
  pm10: number;
  europeanAqi: number;
  pollenTotal: number;
  fetchedAt: Date;
}

interface AQResponse {
  hourly?: {
    time: string[];
    uv_index?: (number | null)[];
    uv_index_clear_sky?: (number | null)[];
    pm2_5?: (number | null)[];
    pm10?: (number | null)[];
    european_aqi?: (number | null)[];
    ozone?: (number | null)[];
    nitrogen_dioxide?: (number | null)[];
    grass_pollen?: (number | null)[];
    olive_pollen?: (number | null)[];
    birch_pollen?: (number | null)[];
  };
  current?: {
    uv_index?: number | null;
    pm2_5?: number | null;
    pm10?: number | null;
    european_aqi?: number | null;
  };
}

const AQ_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';

// UV comes from forecast API (not AQ API)
const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';

/**
 * Fetch current + 24h forecast air quality for a zone center.
 */
export async function fetchAirQuality(
  lat: number,
  lon: number,
): Promise<{ current: AirQualityCurrent; hourly: AirQualityData[] }> {
  // Fetch AQ data (PM, AQI, pollen)
  const aqUrl =
    `${AQ_BASE}?latitude=${lat}&longitude=${lon}` +
    `&hourly=pm2_5,pm10,european_aqi,ozone,nitrogen_dioxide,grass_pollen,olive_pollen,birch_pollen` +
    `&current=pm2_5,pm10,european_aqi` +
    `&forecast_days=2&timezone=Europe%2FMadrid`;

  // Fetch UV from forecast API
  const uvUrl =
    `${FORECAST_BASE}?latitude=${lat}&longitude=${lon}` +
    `&hourly=uv_index,uv_index_clear_sky` +
    `&current=uv_index` +
    `&forecast_days=2&timezone=Europe%2FMadrid`;

  const [aqRes, uvRes] = await Promise.all([
    openMeteoFetch(aqUrl, undefined, 15_000),
    openMeteoFetch(uvUrl, undefined, 15_000),
  ]);

  if (!aqRes.ok) throw new Error(`AQ API ${aqRes.status}`);
  if (!uvRes.ok) throw new Error(`UV API ${uvRes.status}`);

  const aq: AQResponse = await aqRes.json();
  const uv = await uvRes.json() as {
    hourly?: { time: string[]; uv_index?: (number | null)[]; uv_index_clear_sky?: (number | null)[] };
    current?: { uv_index?: number | null };
  };

  // Parse hourly
  const times = aq.hourly?.time ?? [];
  const uvTimes = uv.hourly?.time ?? [];
  const hourly: AirQualityData[] = times.map((t, i) => {
    // Find matching UV index by time
    const uvIdx = uvTimes.indexOf(t);
    return {
      timestamp: new Date(t),
      uvIndex: uvIdx >= 0 ? (uv.hourly?.uv_index?.[uvIdx] ?? null) : null,
      uvIndexClearSky: uvIdx >= 0 ? (uv.hourly?.uv_index_clear_sky?.[uvIdx] ?? null) : null,
      pm2_5: aq.hourly?.pm2_5?.[i] ?? null,
      pm10: aq.hourly?.pm10?.[i] ?? null,
      europeanAqi: aq.hourly?.european_aqi?.[i] ?? null,
      ozone: aq.hourly?.ozone?.[i] ?? null,
      nitrogenDioxide: aq.hourly?.nitrogen_dioxide?.[i] ?? null,
      grassPollen: aq.hourly?.grass_pollen?.[i] ?? null,
      olivePollen: aq.hourly?.olive_pollen?.[i] ?? null,
      birchPollen: aq.hourly?.birch_pollen?.[i] ?? null,
    };
  });

  // Current snapshot (closest to now)
  const pollenTotal =
    (aq.hourly?.grass_pollen?.[0] ?? 0) +
    (aq.hourly?.olive_pollen?.[0] ?? 0) +
    (aq.hourly?.birch_pollen?.[0] ?? 0);

  const current: AirQualityCurrent = {
    uvIndex: (uv.current?.uv_index as number) ?? 0,
    pm2_5: (aq.current?.pm2_5 as number) ?? 0,
    pm10: (aq.current?.pm10 as number) ?? 0,
    europeanAqi: (aq.current?.european_aqi as number) ?? 0,
    pollenTotal,
    fetchedAt: new Date(),
  };

  return { current, hourly };
}

// ── Severity thresholds ──

/** UV Index severity — WHO scale */
export function uvSeverity(uv: number): 'low' | 'moderate' | 'high' | 'very_high' | 'extreme' {
  if (uv >= 11) return 'extreme';
  if (uv >= 8) return 'very_high';
  if (uv >= 6) return 'high';
  if (uv >= 3) return 'moderate';
  return 'low';
}

/** PM2.5 severity — EU AQI bands */
export function pm25Severity(pm: number): 'good' | 'fair' | 'moderate' | 'poor' | 'very_poor' {
  if (pm > 75) return 'very_poor';
  if (pm > 50) return 'poor';
  if (pm > 25) return 'moderate';
  if (pm > 10) return 'fair';
  return 'good';
}

/** Pollen severity */
export function pollenSeverity(total: number): 'none' | 'low' | 'moderate' | 'high' {
  if (total > 100) return 'high';
  if (total > 30) return 'moderate';
  if (total > 5) return 'low';
  return 'none';
}
