/**
 * Observatorio Costeiro da Xunta de Galicia — supplementary buoy data source.
 *
 * API: apis-ext.xunta.gal/mgplatpubapi/v1/api
 * Auth: apikey header with JWT (public, no expiration)
 * Resolution: 10 min (vs 1h for PORTUS CETMAR buoys)
 *
 * 6 platforms — 5 overlap with PORTUS (same physical CETMAR buoy, different API)
 * and 1 is NEW (Muros, 15009).
 *
 * Extra data not in PORTUS: humidity (HR), dew point (TO).
 *
 * Note: Cíes (15002) has been OFFLINE since December 4, 2025.
 * It's included but won't return data until the buoy is repaired.
 */

import type { BuoyReading } from './buoyClient';

// ── Station mapping: Observatorio ID → canonical station ID ──────

interface ObsStation {
  obsId: number;       // Observatorio platform ID
  canonicalId: number; // PORTUS station ID for overlaps, or own ID for new
  name: string;
  lat: number;
  lon: number;
}

const OBS_STATIONS: ObsStation[] = [
  { obsId: 15001, canonicalId: 1250,  name: 'Cortegada (Arousa)', lat: 42.632, lon: -8.779 },
  { obsId: 15002, canonicalId: 1252,  name: 'Islas Cíes',        lat: 42.180, lon: -8.892 }, // OFFLINE since Dec 2025
  { obsId: 15004, canonicalId: 1253,  name: 'A Guarda',          lat: 41.900, lon: -8.876 },
  { obsId: 15005, canonicalId: 1255,  name: 'Ribeira',           lat: 42.554, lon: -8.990 },
  { obsId: 15100, canonicalId: 1251,  name: 'Rande (Ría Vigo)',  lat: 42.288, lon: -8.658 },
  { obsId: 15009, canonicalId: 15009, name: 'Muros',             lat: 42.7195, lon: -9.0153 }, // NEW — no PORTUS equivalent
];

const API_BASE = '/obscosteiro-api';
const API_KEY = import.meta.env.VITE_OBSCOSTEIRO_API_KEY ?? '';
const TIMEOUT = 15_000;
const NO_DATA = -9999;

// ── Types for raw API response ──────────────────────────────────

interface ObsMedicion {
  data: string;       // ISO timestamp
  valor: number;      // Measurement value (-9999 = no data)
  validado: boolean;
}

interface ObsParametro {
  codigoParametro: string; // VV, DV, TA, HR, TO, TAU, SAL, etc.
  funcion: string;         // AVG, MAX, RACHA, etc.
  altura: number;          // Negative = above water (meteo), positive = depth (ocean)
  medicions: ObsMedicion[];
}

// API returns ObsParametro[] directly (array, not wrapped object)
type ObsResponse = ObsParametro[] | { parametros?: ObsParametro[] };

// ── Fetch helpers ───────────────────────────────────────────────

async function obsFetch(boiaId: number, attempt = 0): Promise<ObsResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/ultimo/recente/${boiaId}`, {
      headers: { 'apikey': API_KEY },
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (!res.ok) {
      if (res.status >= 500 && attempt < 1) {
        console.warn(`[ObsCosteiro] ${boiaId} → ${res.status}, retrying in 3s`);
        await new Promise((r) => setTimeout(r, 3000));
        return obsFetch(boiaId, attempt + 1);
      }
      console.warn(`[ObsCosteiro] ${boiaId} → ${res.status}`);
      return null;
    }

    return res.json();
  } catch (err) {
    console.warn(`[ObsCosteiro] ${boiaId} fetch error:`, (err as Error).message);
    return null;
  }
}

// ── Parameter extraction ────────────────────────────────────────

function extractValue(params: ObsParametro[], code: string, func: string, maxDepth?: number): number | null {
  for (const p of params) {
    if (p.codigoParametro !== code) continue;
    if (p.funcion !== func) continue;
    // For ocean params: filter by depth (altura > 0 = depth, we want shallow ≤ 2m)
    if (maxDepth !== undefined && p.altura > maxDepth) continue;
    const m = p.medicions?.[0];
    if (!m || m.valor === NO_DATA) return null;
    return m.valor;
  }
  return null;
}

function extractTimestamp(params: ObsParametro[]): string | null {
  let newest: string | null = null;
  let newestMs = 0;
  for (const p of params) {
    const m = p.medicions?.[0];
    if (!m?.data) continue;
    const ms = new Date(m.data).getTime();
    if (ms > newestMs) { newestMs = ms; newest = m.data; }
  }
  return newest;
}

// ── Convert API response to BuoyReading ─────────────────────────

function parseObsReading(station: ObsStation, data: ObsResponse): BuoyReading | null {
  // API returns array directly, but handle wrapped format too
  const params = Array.isArray(data) ? data : data?.parametros;
  if (!params || params.length === 0) return null;

  const timestamp = extractTimestamp(params);
  if (!timestamp) return null;

  // Check data freshness — skip if older than 2 hours
  const age = Date.now() - new Date(timestamp).getTime();
  if (age > 2 * 60 * 60 * 1000) {
    console.debug(`[ObsCosteiro] ${station.name} stale (${Math.round(age / 60000)}min old), skipping`);
    return null;
  }

  return {
    stationId: station.canonicalId,
    stationName: station.name,
    timestamp,
    // Wave — Observatorio doesn't provide wave data (CETMAR buoys have it via PORTUS)
    waveHeight: null,
    waveHeightMax: null,
    wavePeriod: null,
    wavePeriodMean: null,
    waveDir: null,
    // Wind
    windSpeed: extractValue(params, 'VV', 'AVG'),
    windDir: extractValue(params, 'DV', 'AVG'),
    windGust: extractValue(params, 'VV', 'RACHA') ?? extractValue(params, 'VV', 'MAX'),
    // Temperature
    waterTemp: extractValue(params, 'TAU', 'AVG', 2), // depth ≤ 2m
    airTemp: extractValue(params, 'TA', 'AVG'),
    // Pressure — not available from Observatorio
    airPressure: null,
    // Currents — not in this endpoint
    currentSpeed: null,
    currentDir: null,
    // Salinity
    salinity: extractValue(params, 'SAL', 'AVG', 2), // depth ≤ 2m
    // Sea level
    seaLevel: null,
    // Observatorio-exclusive fields
    humidity: extractValue(params, 'HR', 'AVG'),
    dewPoint: extractValue(params, 'TO', 'AVG'),
    source: 'obscosteiro',
  };
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Fetch latest readings from all Observatorio Costeiro platforms.
 * Returns BuoyReading[] with canonical station IDs (matching PORTUS IDs for overlaps).
 * Fails silently per station — returns whatever succeeds.
 */
export async function fetchAllObsReadings(): Promise<BuoyReading[]> {
  if (!API_KEY) {
    console.debug('[ObsCosteiro] No API key configured, skipping');
    return [];
  }

  const results = await Promise.allSettled(
    OBS_STATIONS.map(async (station) => {
      const data = await obsFetch(station.obsId);
      if (!data) return null;
      return parseObsReading(station, data);
    })
  );

  const readings = results
    .filter((r): r is PromiseFulfilledResult<BuoyReading | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((r): r is BuoyReading => r != null);

  if (readings.length > 0) {
    console.debug(`[ObsCosteiro] ${readings.length} readings fetched (${readings.map(r => r.stationName).join(', ')})`);
  }

  return readings;
}
