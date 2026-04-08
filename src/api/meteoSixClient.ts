/**
 * MeteoSIX v5 API client — MeteoGalicia forecast API
 * WRF 1km atmospheric + USWAN marine + MOHID ocean models
 * Docs: https://meteo-estaticos.xunta.gal/datosred/infoweb/meteo/proxectos/meteosix/API_MeteoSIX_v5_gl.pdf
 *
 * v5 changes from v4:
 * - Grids RiasBaixas1Km/Artabro1Km/NortePortugal1Km → unified `1km`
 * - SWAN → USWAN with malla `Galicia`
 * - Same API key works for both v4 and v5
 */
import type { HourlyForecast } from '../types/forecast';
import type { MarineForecastHour } from './marineClient';
import { METEOSIX } from '../config/apiEndpoints';

// ── MeteoSIX response types ──

interface MeteoSIXVariable {
  name: string;
  units: string;
  values: Array<{
    timeInstant: string;  // "2026-04-08T14:00:00+02"
    value: string | number | null; // numeric or categorical (sky_state)
    iconURL?: string;     // wind/sky icons
    moduleValue?: number | string; // wind speed (km/h default)
    directionValue?: number | string; // wind direction (degrees)
  }>;
}

interface MeteoSIXFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    days: Array<{
      timePeriod: { begin: { timeInstant: string }; end: { timeInstant: string } };
      variables: MeteoSIXVariable[];
    }>;
  };
}

interface MeteoSIXResponse {
  type: 'FeatureCollection';
  features: MeteoSIXFeature[];
}

// ── Variable names for the API request ──

/** WRF atmospheric variables — wind in m/s direct (ms_deg) */
const ATMO_VARIABLES = [
  'temperature',
  'wind',
  'precipitation_amount',
  'relative_humidity',
  'cloud_area_fraction',
  'air_pressure_at_sea_level',
  'sky_state',
  'snow_level',
].join(',');

/** USWAN nearshore wave variables */
const MARINE_VARIABLES = [
  'significative_wave_height',
  'mean_wave_direction',
  'relative_peak_period',
].join(',');

// ── sky_state → isDay mapping ──

/** Night sky states from MeteoSIX (no explicit isDay flag) */
const NIGHT_STATES = new Set([
  'CLEAR_NIGHT', 'NIGHT_CLOUDS', 'NIGHT_CLOUDY',
  'NIGHT_RAIN', 'NIGHT_SHOWERS', 'NIGHT_SNOW', 'NIGHT_STORMS',
]);

/** Storm sky states for potential cross-reference with storm predictor */
const STORM_STATES = new Set(['STORMS', 'STORM_THEN_CLOUDY', 'NIGHT_STORMS']);

function isDayFromSkyState(skyState: string | null, date: Date): boolean {
  if (skyState && NIGHT_STATES.has(skyState)) return false;
  if (skyState && !NIGHT_STATES.has(skyState)) return true;
  // Fallback heuristic if skyState is null
  const h = date.getHours();
  return h >= 7 && h < 21;
}

// ── Transform helpers ──

/** km/h → m/s */
function kmhToMs(kmh: number | null): number | null {
  return kmh != null ? kmh / 3.6 : null;
}

/** Fix MeteoSIX time format: "+02" → "+02:00" (JS Date requires colon in offset) */
function fixTimeOffset(timeStr: string): string {
  // "2026-04-08T15:00:00+02" → "2026-04-08T15:00:00+02:00"
  return timeStr.replace(/([+-]\d{2})$/, '$1:00');
}

/** Parse value that may be string, number, or null */
function parseNum(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Parse response into time→variable map ──

function parseFeatureToTimeMap(feature: MeteoSIXFeature): Map<string, Record<string, string | number | null>> {
  const timeMap = new Map<string, Record<string, string | number | null>>();

  for (const day of feature.properties.days) {
    for (const variable of day.variables) {
      for (const val of variable.values) {
        const key = val.timeInstant;
        if (!timeMap.has(key)) timeMap.set(key, {});
        const record = timeMap.get(key)!;

        if (variable.name === 'wind') {
          // Wind: moduleValue (km/h) + directionValue (degrees) — both can be number
          record['wind_speed'] = val.moduleValue ?? null;
          record['wind_direction'] = val.directionValue ?? null;
        } else {
          record[variable.name] = val.value ?? null;
        }
      }
    }
  }

  return timeMap;
}

// ── Public API ──

/**
 * Fetch WRF atmospheric forecast from MeteoSIX v5.
 * Returns HourlyForecast[] mapped to our standard interface.
 * Includes sky_state (categorical) and snow_level.
 * Wind comes in m/s directly (units=ms_deg), no conversion needed.
 * Fields not available in WRF (CAPE, CIN, LI, gusts, solar, visibility, PBL) → null.
 */
export async function fetchMeteoSixForecast(
  lat: number,
  lon: number,
): Promise<HourlyForecast[]> {
  // Wind default is km/h — we convert to m/s in the transform below
  const url = METEOSIX.forecast(lon, lat, ATMO_VARIABLES, '1km', 'WRF');

  // MeteoSIX 1km grid with 8 variables can take 20-30s to respond
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`MeteoSIX WRF: ${res.status} — ${text.slice(0, 200)}`);
  }

  const data: MeteoSIXResponse = await res.json();

  if (!data.features || data.features.length === 0) {
    throw new Error('MeteoSIX: no features in response');
  }

  const timeMap = parseFeatureToTimeMap(data.features[0]);
  const result: HourlyForecast[] = [];
  const sortedTimes = [...timeMap.keys()].sort();

  for (const timeStr of sortedTimes) {
    const rec = timeMap.get(timeStr)!;
    const time = new Date(fixTimeOffset(timeStr));
    if (isNaN(time.getTime())) continue;

    const skyState = rec['sky_state'] ?? null;

    result.push({
      time,
      temperature: parseNum(rec['temperature']),
      humidity: parseNum(rec['relative_humidity']),
      windSpeed: kmhToMs(parseNum(rec['wind_speed'])), // km/h → m/s
      windDirection: parseNum(rec['wind_direction']),
      windGusts: null,
      precipitation: parseNum(rec['precipitation_amount']),
      precipProbability: null,
      cloudCover: parseNum(rec['cloud_area_fraction']),
      pressure: parseNum(rec['air_pressure_at_sea_level']),
      solarRadiation: null,
      cape: null,
      liftedIndex: null,
      cin: null,
      boundaryLayerHeight: null,
      visibility: null,
      snowLevel: parseNum(rec['snow_level']),
      skyState,
      isDay: isDayFromSkyState(skyState, time),
    });
  }

  return result;
}

/**
 * Fetch USWAN nearshore wave forecast from MeteoSIX v5.
 * Better than Open-Meteo Marine for Galician surf spots.
 * Returns MarineForecastHour[] compatible with existing marine pipeline.
 */
export async function fetchMeteoSixMarine(
  lat: number,
  lon: number,
): Promise<MarineForecastHour[]> {
  const url = METEOSIX.forecast(lon, lat, MARINE_VARIABLES, 'Galicia', 'USWAN');

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`MeteoSIX USWAN: ${res.status} — ${text.slice(0, 200)}`);
  }

  const data: MeteoSIXResponse = await res.json();
  if (!data.features || data.features.length === 0) {
    throw new Error('MeteoSIX USWAN: no features in response');
  }

  const timeMap = parseFeatureToTimeMap(data.features[0]);
  const result: MarineForecastHour[] = [];
  const sortedTimes = [...timeMap.keys()].sort();

  for (const timeStr of sortedTimes) {
    const rec = timeMap.get(timeStr)!;
    const time = new Date(fixTimeOffset(timeStr));
    if (isNaN(time.getTime())) continue;

    result.push({
      time,
      waveHeight: parseNum(rec['significative_wave_height']),
      wavePeriod: parseNum(rec['relative_peak_period']),
      waveDirection: parseNum(rec['mean_wave_direction']),
      swellHeight: null,     // USWAN doesn't separate swell
      swellPeriod: null,
      swellDirection: null,
    });
  }

  return result;
}

/**
 * Fetch sea water temperature from MOHID model (Rías Baixas).
 * MOHID has 0.003° resolution (~300m) for Vigo, Arousa, Artabro estuaries.
 * Returns hourly sea_water_temperature for the nearest point.
 */
export async function fetchMeteoSixSeaTemp(
  lat: number,
  lon: number,
): Promise<Array<{ time: Date; seaTemp: number | null }>> {
  const url = METEOSIX.forecast(lon, lat, 'sea_water_temperature', 'Vigo', 'MOHID');

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return []; // Silently fail — MOHID coverage is limited

  const data: MeteoSIXResponse = await res.json();
  if (!data.features || data.features.length === 0) return [];

  const timeMap = parseFeatureToTimeMap(data.features[0]);
  const result: Array<{ time: Date; seaTemp: number | null }> = [];
  const sortedTimes = [...timeMap.keys()].sort();

  for (const timeStr of sortedTimes) {
    const rec = timeMap.get(timeStr)!;
    const time = new Date(fixTimeOffset(timeStr));
    if (isNaN(time.getTime())) continue;
    result.push({ time, seaTemp: parseNum(rec['sea_water_temperature']) });
  }

  return result;
}

/** Check if a sky state indicates storms (for cross-reference with predictor) */
export function isStormSkyState(skyState: string | null): boolean {
  return skyState != null && STORM_STATES.has(skyState);
}
