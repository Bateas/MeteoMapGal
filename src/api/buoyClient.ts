/**
 * Buoy API client — fetches marine data from Puertos del Estado (PORTUS).
 *
 * Two APIs:
 * - portussvr: Station metadata + last readings (integer-encoded, /factor)
 * - poem: Time series data (real units)
 *
 * 12 stations covering all 3 Rías Baixas:
 *
 * Ría de Vigo:
 *   1251 Plataforma de Rande   (42.29, -8.66) — CETMAR/Ría de Vigo
 *   1252 Islas Cíes             (42.17, -8.91) — CETMAR/bocana Vigo
 *   3221 Vigo 2                 (42.24, -8.73) — REDMAR tide gauge
 *
 * Ría de Pontevedra:
 *   4271 Lourizán               (42.41, -8.66) — REMPOR port met
 *   4272 Ons                    (42.38, -8.94) — REMPOR isla
 *   4273 Cabo Udra              (42.34, -8.83) — REMPOR costa
 *   3223 Marín                  (42.41, -8.69) — REDMAR tide gauge
 *
 * Ría de Arousa:
 *   1250 Cortegada              (42.63, -8.78) — CETMAR/batea
 *   1255 Ribeira                (42.55, -8.95) — CETMAR/externa
 *   3220 Vilagarcía             (42.60, -8.77) — REDMAR tide gauge
 *
 * Exterior:
 *   2248 Cabo Silleiro          (42.12, -9.43) — REDEXT deep-water
 *   1253 A Guarda               (41.90, -8.90) — CETMAR/externa
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
  currentSpeed: number | null;     // m/s (API returns cm/s, divided by 100 in parser)
  currentDir: number | null;       // deg
  // Salinity
  salinity: number | null;         // PSU
  // Sea level (tide gauges)
  seaLevel: number | null;         // cm
}

/** Predefined stations for Rías Baixas sector — all 3 Rías covered */
export const RIAS_BUOY_STATIONS: { id: number; name: string; lat: number; lon: number; type: string }[] = [
  // ── Exterior / Atlántico ──
  { id: 2248, name: 'Cabo Silleiro',      lat: 42.12, lon: -9.43, type: 'REDEXT' },
  { id: 1253, name: 'A Guarda',           lat: 41.90, lon: -8.90, type: 'CETMAR' },
  // ── Ría de Vigo ──
  { id: 1252, name: 'Islas Cíes',         lat: 42.17, lon: -8.91, type: 'CETMAR' },
  { id: 1251, name: 'Rande (Ría Vigo)',   lat: 42.29, lon: -8.66, type: 'CETMAR' },
  { id: 3221, name: 'Vigo (marea)',       lat: 42.24, lon: -8.73, type: 'REDMAR' },
  // ── Ría de Pontevedra ──
  { id: 4272, name: 'Ons',                lat: 42.38, lon: -8.94, type: 'REMPOR' },
  { id: 4273, name: 'Cabo Udra',          lat: 42.34, lon: -8.83, type: 'REMPOR' },
  { id: 4271, name: 'Lourizán',           lat: 42.41, lon: -8.66, type: 'REMPOR' },
  { id: 3223, name: 'Marín (marea)',      lat: 42.41, lon: -8.69, type: 'REDMAR' },
  // ── Ría de Arousa ──
  { id: 1250, name: 'Cortegada (Arousa)', lat: 42.63, lon: -8.78, type: 'CETMAR' },
  { id: 1255, name: 'Ribeira',            lat: 42.55, lon: -8.95, type: 'CETMAR' },
  { id: 3220, name: 'Vilagarcía (marea)', lat: 42.60, lon: -8.77, type: 'REDMAR' },
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
