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
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 2000; // 2s, 4s exponential

/** User-friendly error messages */
function friendlyError(status: number): string {
  switch (status) {
    case 503: return 'Puertos del Estado no disponible temporalmente';
    case 502: return 'Puertos del Estado no responde';
    case 500: return 'Error en servidor de Puertos del Estado';
    case 429: return 'Demasiadas solicitudes a Puertos del Estado';
    case 404: return 'Estación no encontrada en Puertos del Estado';
    default: return `Error de conexión con Puertos del Estado (${status})`;
  }
}

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
  // Observatorio Costeiro-exclusive fields
  humidity: number | null;         // % — only from Observatorio Costeiro
  dewPoint: number | null;         // °C — only from Observatorio Costeiro
  /** Data source: 'portus' (default) or 'obscosteiro' (Observatorio Costeiro da Xunta) */
  source?: 'portus' | 'obscosteiro';
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
  // ── Ría de Muros-Noia (Observatorio Costeiro only) ──
  { id: 15009, name: 'Muros',             lat: 42.7195, lon: -9.0153, type: 'OBSCOSTEIRO' },
];

/** Pre-built coordinates lookup for all buoy stations (shared across components) */
export const BUOY_COORDS_MAP = new Map(
  RIAS_BUOY_STATIONS.map((s) => [s.id, { lat: s.lat, lon: s.lon }]),
);

// ── Portus API response types ────────────────────────────

/** Station object returned by /estaciones/rt/{category} endpoint */
interface PortusStationResponse {
  id: number;
  nombre: string;
  latitud: number;
  longitud: number;
  red?: { descripcion?: string; tipoRed?: string };
  tipoSensor?: string;
  cadencia?: number;
  disponible?: boolean;
  altitudProfundidad?: number;
}

/** Individual data point within lastData response */
interface PortusDatoEntry {
  /** ESEOO parameter name: Hm0, Tp, WindSpeed, WaterTemp, etc. */
  paramEseoo: string;
  /** Integer-encoded value (divide by factor for real units) */
  valor: string;
  /** Divisor to convert integer to real value (default: 1) */
  factor?: number;
  /** True if sensor is broken / data invalid */
  averia?: boolean;
  /** Quality control flag (non-null = suspect data) */
  paramQC?: string | number | null;
}

/** Response from POST /lastData/station/{id} endpoint */
interface PortusLastDataResponse {
  /** ISO timestamp of the reading */
  fecha: string;
  /** Array of parameter readings for the station */
  datos: PortusDatoEntry[];
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Fetch from portussvr API (POST with JSON body).
 * Retries on 5xx errors with exponential backoff.
 */
async function portusPost<T>(path: string, body?: unknown, attempt = 0): Promise<T> {
  const res = await fetch(`${PORTUS_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT),
  });

  if (!res.ok) {
    // Retry on 5xx server errors
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_MS * Math.pow(2, attempt);
      console.warn(`[Buoy] POST ${path} → ${res.status}, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      return portusPost<T>(path, body, attempt + 1);
    }
    throw new Error(friendlyError(res.status));
  }

  return res.json();
}

async function portusGet<T>(path: string, attempt = 0): Promise<T> {
  const res = await fetch(`${PORTUS_API}${path}`, {
    signal: AbortSignal.timeout(TIMEOUT),
  });

  if (!res.ok) {
    // Retry on 5xx server errors
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_MS * Math.pow(2, attempt);
      console.warn(`[Buoy] GET ${path} → ${res.status}, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      return portusGet<T>(path, attempt + 1);
    }
    throw new Error(friendlyError(res.status));
  }

  return res.json();
}

// ── API Functions ────────────────────────────────────────

/**
 * Discover available stations for a category.
 * Categories: WAVE, WIND, SEA_LEVEL, WATER_TEMP, AIR_TEMP, CURRENTS, SALINITY
 */
export async function fetchBuoyStations(category: string = 'WAVE'): Promise<BuoyStation[]> {
  const raw = await portusGet<PortusStationResponse[]>(`/estaciones/rt/${category}?locale=es`);

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
    const result = await portusPost<PortusLastDataResponse>(
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
      humidity: null,
      dewPoint: null,
      source: 'portus',
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

// ── Merge PORTUS + Observatorio readings ──────────────────────

/**
 * Merge buoy readings from two sources, preferring the NEWEST timestamp.
 * For overlapping stations (same canonicalId):
 * - If Observatorio is newer → use it, but preserve PORTUS-exclusive fields (wave, current, seaLevel)
 * - If PORTUS is newer → keep PORTUS
 * For Muros (15009) → always added (no PORTUS equivalent)
 */
export function mergeBuoyReadings(portus: BuoyReading[], obs: BuoyReading[]): BuoyReading[] {
  const map = new Map<number, BuoyReading>();

  // Seed with PORTUS readings
  for (const r of portus) {
    map.set(r.stationId, r);
  }

  // Merge Observatorio readings
  for (const obsR of obs) {
    const existing = map.get(obsR.stationId);

    if (!existing) {
      // New station (Muros) — add directly
      map.set(obsR.stationId, obsR);
      continue;
    }

    // Compare timestamps — prefer newest
    const existingTime = new Date(existing.timestamp).getTime();
    const obsTime = new Date(obsR.timestamp).getTime();

    if (obsTime > existingTime) {
      // Observatorio is newer — use it, but preserve PORTUS-exclusive fields
      map.set(obsR.stationId, {
        ...obsR,
        waveHeight: obsR.waveHeight ?? existing.waveHeight,
        waveHeightMax: obsR.waveHeightMax ?? existing.waveHeightMax,
        wavePeriod: obsR.wavePeriod ?? existing.wavePeriod,
        wavePeriodMean: obsR.wavePeriodMean ?? existing.wavePeriodMean,
        waveDir: obsR.waveDir ?? existing.waveDir,
        currentSpeed: obsR.currentSpeed ?? existing.currentSpeed,
        currentDir: obsR.currentDir ?? existing.currentDir,
        seaLevel: obsR.seaLevel ?? existing.seaLevel,
        airPressure: obsR.airPressure ?? existing.airPressure,
      });
    } else {
      // PORTUS is newer — keep it, but merge ObsCosteiro-exclusive fields
      // (humidity, dewPoint only come from Observatorio Costeiro)
      map.set(obsR.stationId, {
        ...existing,
        humidity: existing.humidity ?? obsR.humidity,
        dewPoint: existing.dewPoint ?? obsR.dewPoint,
        // Also fill gaps in shared fields if PORTUS has nulls
        airTemp: existing.airTemp ?? obsR.airTemp,
        waterTemp: existing.waterTemp ?? obsR.waterTemp,
      });
    }
  }

  return Array.from(map.values());
}
