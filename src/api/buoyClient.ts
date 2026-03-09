/**
 * Buoy API client — fetches marine data from Puertos del Estado (PORTUS).
 *
 * Two APIs:
 * - portussvr: Station metadata + last readings (integer-encoded, /factor)
 * - poem: Time series data (real units)
 *
 * Stations relevant for Rías Baixas:
 *   2248 Boya de Cabo Silleiro (42.12, -9.43) — REDEXT deep-water
 *   1251 Plataforma de Rande   (42.29, -8.66) — CETMAR/Ría de Vigo
 *   1253 Boya de A Guarda       (41.90, -8.90) — External
 *   1255 Boya de Ribeira        (42.55, -8.95) — External
 *   4271 Lourizan (Pontevedra)  (42.41, -8.66) — REMPOR port met
 *   3221 Vigo 2                  (42.24, -8.73) — REDMAR tide gauge
 *
 * No auth required. Hourly updates for buoys, 10-min for REMPOR.
 */

const PORTUS_API = '/portus-api';  // proxied → portus.puertos.es/portussvr/api
const TIMEOUT = 20_000;

// ── Types ──────────────────────────────────────────────

export interface BuoyStation {
  id: number;
  nombre: string;
  latitud: number;
  longitud: number;
  red: string;         // REDEXT, REDCOS, REMPOR, REDMAR, EXTERNOS
  tipoSensor: string;
  cadencia: number;    // minutes
  disponible: boolean;
  altitudProfundidad: number;
}

export interface BuoyReading {
  stationId: number;
  stationName: string;
  timestamp: string;
  // Wave
  waveHeight: number | null;       // Hm0 (m)
  waveHeightMax: number | null;    // Hmax (m)
  wavePeriod: number | null;       // Tp (s)
  wavePeriodMean: number | null;   // Tm02 (s)
  waveDir: number | null;          // MeanDir (deg)
  // Wind
  windSpeed: number | null;        // m/s
  windDir: number | null;          // deg (from)
  windGust: number | null;         // m/s (REMPOR only)
  // Temperature
  waterTemp: number | null;        // °C
  airTemp: number | null;          // °C
  // Pressure
  airPressure: number | null;      // hPa
  // Currents
  currentSpeed: number | null;     // cm/s
  currentDir: number | null;       // deg
  // Salinity
  salinity: number | null;         // PSU
  // Sea level (tide gauges)
  seaLevel: number | null;         // cm
}

/** Predefined stations for Rías Baixas sector */
export const RIAS_BUOY_STATIONS: { id: number; name: string; lat: number; lon: number; type: string }[] = [
  { id: 2248, name: 'Cabo Silleiro', lat: 42.12, lon: -9.43, type: 'REDEXT' },
  { id: 1251, name: 'Rande (Ría Vigo)', lat: 42.29, lon: -8.66, type: 'CETMAR' },
  { id: 1253, name: 'A Guarda', lat: 41.90, lon: -8.90, type: 'CETMAR' },
  { id: 1255, name: 'Ribeira', lat: 42.55, lon: -8.95, type: 'CETMAR' },
  { id: 4271, name: 'Lourizán', lat: 42.41, lon: -8.66, type: 'REMPOR' },
  { id: 3221, name: 'Vigo (marea)', lat: 42.24, lon: -8.73, type: 'REDMAR' },
];

// ── Helpers ──────────────────────────────────────────────

/**
 * Fetch from portussvr API (POST with JSON body).
 */
async function portusPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${PORTUS_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT),
  });

  if (!res.ok) {
    throw new Error(`Portus API error ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

async function portusGet<T>(path: string): Promise<T> {
  const res = await fetch(`${PORTUS_API}${path}`, {
    signal: AbortSignal.timeout(TIMEOUT),
  });

  if (!res.ok) {
    throw new Error(`Portus API error ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

// ── API Functions ────────────────────────────────────────

/**
 * Discover available stations for a category.
 * Categories: WAVE, WIND, SEA_LEVEL, WATER_TEMP, AIR_TEMP, CURRENTS, SALINITY
 */
export async function fetchBuoyStations(category: string = 'WAVE'): Promise<BuoyStation[]> {
  const raw = await portusGet<any[]>(`/estaciones/rt/${category}?locale=es`);

  return raw.map((s) => ({
    id: s.id,
    nombre: s.nombre,
    latitud: s.latitud,
    longitud: s.longitud,
    red: s.red?.descripcion ?? s.red?.tipoRed ?? 'unknown',
    tipoSensor: s.tipoSensor ?? '',
    cadencia: s.cadencia ?? 60,
    disponible: s.disponible ?? false,
    altitudProfundidad: s.altitudProfundidad ?? 0,
  }));
}

/**
 * Get the latest reading for a buoy station.
 * Decodes integer-encoded values using the factor field.
 */
export async function fetchBuoyLastReading(stationId: number, stationName?: string): Promise<BuoyReading | null> {
  try {
    const categories = ['WAVE', 'WIND', 'WATER_TEMP', 'AIR_TEMP', 'SEA_LEVEL', 'CURRENTS', 'SALINITY'];
    const result = await portusPost<{ fecha: string; datos: any[] }>(
      `/lastData/station/${stationId}?locale=es`,
      categories
    );

    if (!result?.datos?.length) return null;

    const reading: BuoyReading = {
      stationId,
      stationName: stationName ?? `Boya ${stationId}`,
      timestamp: result.fecha,
      waveHeight: null,
      waveHeightMax: null,
      wavePeriod: null,
      wavePeriodMean: null,
      waveDir: null,
      windSpeed: null,
      windDir: null,
      windGust: null,
      waterTemp: null,
      airTemp: null,
      airPressure: null,
      currentSpeed: null,
      currentDir: null,
      salinity: null,
      seaLevel: null,
    };

    for (const d of result.datos) {
      if (d.averia || d.paramQC) continue;

      const val = parseInt(d.valor, 10);
      if (isNaN(val)) continue;

      const factor = d.factor || 1;
      const real = val / factor;

      switch (d.paramEseoo) {
        case 'Hm0': reading.waveHeight = real; break;
        case 'Hmax': reading.waveHeightMax = real; break;
        case 'Tp': reading.wavePeriod = real; break;
        case 'Tm02': reading.wavePeriodMean = real; break;
        case 'MeanDir': reading.waveDir = real; break;
        case 'WindSpeed': reading.windSpeed = real; break;
        case 'WindDir': reading.windDir = real; break;
        case 'WindSpeedMax': reading.windGust = real; break;
        case 'WaterTemp': reading.waterTemp = real; break;
        case 'AirTemp': reading.airTemp = real; break;
        case 'AirPressure': reading.airPressure = real; break;
        case 'CurrentSpeed': reading.currentSpeed = real / 100; break; // cm/s → m/s
        case 'CurrentDir': reading.currentDir = real; break;
        case 'Salinity': reading.salinity = real; break;
        case 'SeaLevel': reading.seaLevel = real; break;
      }
    }

    return reading;
  } catch (err) {
    console.warn(`[BuoyClient] lastData failed for station ${stationId}:`, (err as Error).message);
    return null;
  }
}

/**
 * Fetch latest readings for all Rías Baixas buoy stations.
 * Fails silently per station — returns whatever succeeds.
 */
export async function fetchAllRiasBuoys(): Promise<BuoyReading[]> {
  const results = await Promise.allSettled(
    RIAS_BUOY_STATIONS.map((s) => fetchBuoyLastReading(s.id, s.name))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<BuoyReading | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((r): r is BuoyReading => r != null);
}
