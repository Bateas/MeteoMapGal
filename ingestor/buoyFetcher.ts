/**
 * Server-side buoy data fetcher for the ingestor.
 *
 * Fetches from two sources:
 * - Puertos del Estado (PORTUS) — 12 stations, hourly/10min
 * - Observatorio Costeiro da Xunta — 6 platforms, 10min, humidity+dewPoint
 *
 * Returns merged BuoyReadingRow[] ready for DB insert.
 */

import type { BuoyReadingRow } from './db.js';
import { log } from './logger.js';

const PORTUS_BASE = 'https://portus.puertos.es/portussvr/api';
const OBS_BASE = 'https://apis-ext.xunta.gal/mgplatpubapi/v1/api';
const TIMEOUT = 20_000;

// ── Station definitions ─────────────────────────────────

interface BuoyStation {
  id: number;
  name: string;
  type: string;
}

const RIAS_BUOY_STATIONS: BuoyStation[] = [
  // Exterior
  { id: 2248, name: 'Cabo Silleiro', type: 'REDEXT' },
  { id: 1253, name: 'A Guarda', type: 'CETMAR' },
  // Ría de Vigo
  { id: 1252, name: 'Islas Cíes', type: 'CETMAR' },
  { id: 1251, name: 'Rande (Ría Vigo)', type: 'CETMAR' },
  { id: 3221, name: 'Vigo (marea)', type: 'REDMAR' },
  // Ría de Pontevedra
  { id: 4272, name: 'Ons', type: 'REMPOR' },
  { id: 4273, name: 'Cabo Udra', type: 'REMPOR' },
  { id: 4271, name: 'Lourizán', type: 'REMPOR' },
  { id: 3223, name: 'Marín (marea)', type: 'REDMAR' },
  // Ría de Arousa
  { id: 1250, name: 'Cortegada (Arousa)', type: 'CETMAR' },
  { id: 1255, name: 'Ribeira', type: 'CETMAR' },
  { id: 3220, name: 'Vilagarcía (marea)', type: 'REDMAR' },
];

interface ObsStation {
  obsId: number;
  canonicalId: number;
  name: string;
}

const OBS_STATIONS: ObsStation[] = [
  { obsId: 15001, canonicalId: 1250, name: 'Cortegada (Arousa)' },
  { obsId: 15002, canonicalId: 1252, name: 'Islas Cíes' },     // OFFLINE since Dec 2025
  { obsId: 15004, canonicalId: 1253, name: 'A Guarda' },
  { obsId: 15005, canonicalId: 1255, name: 'Ribeira' },
  { obsId: 15100, canonicalId: 1251, name: 'Rande (Ría Vigo)' },
  { obsId: 15009, canonicalId: 15009, name: 'Muros' },          // NEW — no PORTUS equivalent
];

const NO_DATA = -9999;
const MAX_AGE_MS = 2 * 60 * 60_000; // 2 hours

// ── PORTUS fetch ────────────────────────────────────────

async function fetchPortusStation(station: BuoyStation): Promise<BuoyReadingRow | null> {
  try {
    const categories = ['WAVE', 'WIND', 'WATER_TEMP', 'AIR_TEMP', 'SEA_LEVEL', 'CURRENTS', 'SALINITY'];
    const res = await fetch(`${PORTUS_BASE}/lastData/station/${station.id}?locale=es`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(categories),
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (!res.ok) {
      if (res.status >= 500) {
        // Single retry for 5xx
        await new Promise((r) => setTimeout(r, 3000));
        const retry = await fetch(`${PORTUS_BASE}/lastData/station/${station.id}?locale=es`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(categories),
          signal: AbortSignal.timeout(TIMEOUT),
        });
        if (!retry.ok) return null;
        const retryData = await retry.json();
        return parsePortusResponse(station, retryData);
      }
      return null;
    }

    const data = await res.json();
    return parsePortusResponse(station, data);
  } catch (err) {
    log.warn(`PORTUS ${station.name} (${station.id}): ${(err as Error).message}`);
    return null;
  }
}

function parsePortusResponse(
  station: BuoyStation,
  data: { fecha?: string; datos?: any[] }
): BuoyReadingRow | null {
  if (!data?.datos?.length || !data.fecha) return null;

  // Check freshness
  const age = Date.now() - new Date(data.fecha).getTime();
  if (age > MAX_AGE_MS) return null;

  const row: BuoyReadingRow = {
    time: data.fecha,
    stationId: station.id,
    stationName: station.name,
    source: 'portus',
    waveHeight: null, waveHeightMax: null, wavePeriod: null,
    wavePeriodMean: null, waveDir: null,
    windSpeed: null, windDir: null, windGust: null,
    waterTemp: null, airTemp: null, airPressure: null,
    currentSpeed: null, currentDir: null,
    salinity: null, seaLevel: null,
    humidity: null, dewPoint: null,
  };

  for (const d of data.datos) {
    if (d.averia || d.paramQC) continue;
    const val = parseInt(d.valor, 10);
    if (isNaN(val)) continue;
    const factor = d.factor || 1;
    const real = val / factor;

    switch (d.paramEseoo) {
      case 'Hm0': row.waveHeight = real; break;
      case 'Hmax': row.waveHeightMax = real; break;
      case 'Tp': row.wavePeriod = real; break;
      case 'Tm02': row.wavePeriodMean = real; break;
      case 'MeanDir': row.waveDir = real; break;
      case 'WindSpeed': row.windSpeed = real; break;
      case 'WindDir': row.windDir = real; break;
      case 'WindSpeedMax': row.windGust = real; break;
      case 'WaterTemp': row.waterTemp = real; break;
      case 'AirTemp': row.airTemp = real; break;
      case 'AirPressure': row.airPressure = real; break;
      case 'CurrentSpeed': row.currentSpeed = real / 100; break; // cm/s → m/s
      case 'CurrentDir': row.currentDir = real; break;
      case 'Salinity': row.salinity = real; break;
      case 'SeaLevel': row.seaLevel = real; break;
    }
  }

  return row;
}

// ── Observatorio Costeiro fetch ─────────────────────────

interface ObsMedicion { data: string; valor: number; }
interface ObsParametro {
  codigoParametro: string;
  funcion: string;
  altura: number;
  medicions: ObsMedicion[];
}
// API returns ObsParametro[] directly (array, not wrapped object)

function extractObs(params: ObsParametro[], code: string, func: string, maxDepth?: number): number | null {
  for (const p of params) {
    if (p.codigoParametro !== code || p.funcion !== func) continue;
    if (maxDepth !== undefined && p.altura > maxDepth) continue;
    const m = p.medicions?.[0];
    if (!m || m.valor === NO_DATA) return null;
    return m.valor;
  }
  return null;
}

function extractObsTimestamp(params: ObsParametro[]): string | null {
  for (const p of params) {
    const m = p.medicions?.[0];
    if (m?.data) return m.data;
  }
  return null;
}

async function fetchObsStation(station: ObsStation, apiKey: string): Promise<BuoyReadingRow | null> {
  try {
    const res = await fetch(`${OBS_BASE}/ultimo/recente/${station.obsId}`, {
      headers: { 'apikey': apiKey },
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (!res.ok) {
      if (res.status >= 500) {
        await new Promise((r) => setTimeout(r, 3000));
        const retry = await fetch(`${OBS_BASE}/ultimo/recente/${station.obsId}`, {
          headers: { 'apikey': apiKey },
          signal: AbortSignal.timeout(TIMEOUT),
        });
        if (!retry.ok) return null;
        return parseObsResponse(station, await retry.json());
      }
      return null;
    }

    return parseObsResponse(station, await res.json());
  } catch (err) {
    log.warn(`ObsCosteiro ${station.name} (${station.obsId}): ${(err as Error).message}`);
    return null;
  }
}

function parseObsResponse(station: ObsStation, data: ObsParametro[] | { parametros?: ObsParametro[] }): BuoyReadingRow | null {
  // API returns array directly, but handle wrapped format too
  const params = Array.isArray(data) ? data : data?.parametros;
  if (!params?.length) return null;

  const timestamp = extractObsTimestamp(params);
  if (!timestamp) return null;

  const age = Date.now() - new Date(timestamp).getTime();
  if (age > MAX_AGE_MS) return null;

  return {
    time: timestamp,
    stationId: station.canonicalId,
    stationName: station.name,
    source: 'obscosteiro',
    waveHeight: null, waveHeightMax: null, wavePeriod: null,
    wavePeriodMean: null, waveDir: null,
    windSpeed: extractObs(params, 'VV', 'AVG'),
    windDir: extractObs(params, 'DV', 'AVG'),
    windGust: extractObs(params, 'VV', 'RACHA') ?? extractObs(params, 'VV', 'MAX'),
    waterTemp: extractObs(params, 'TAU', 'AVG', 2),
    airTemp: extractObs(params, 'TA', 'AVG'),
    airPressure: null,
    currentSpeed: null, currentDir: null,
    salinity: extractObs(params, 'SAL', 'AVG', 2),
    seaLevel: null,
    humidity: extractObs(params, 'HR', 'AVG'),
    dewPoint: extractObs(params, 'TO', 'AVG'),
  };
}

// ── Merge logic ─────────────────────────────────────────

function mergeBuoyReadings(portus: BuoyReadingRow[], obs: BuoyReadingRow[]): BuoyReadingRow[] {
  const map = new Map<number, BuoyReadingRow>();

  for (const r of portus) map.set(r.stationId, r);

  for (const obsR of obs) {
    const existing = map.get(obsR.stationId);

    if (!existing) {
      // New station (Muros)
      map.set(obsR.stationId, obsR);
      continue;
    }

    const existingTime = new Date(existing.time).getTime();
    const obsTime = new Date(obsR.time).getTime();

    if (obsTime > existingTime) {
      // Observatorio is newer — use it, preserve PORTUS-exclusive fields
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
    }
  }

  return Array.from(map.values());
}

// ── Public API ──────────────────────────────────────────

/**
 * Fetch all buoy observations from PORTUS + Observatorio Costeiro.
 * Returns merged BuoyReadingRow[] ready for DB insert.
 */
export async function fetchBuoyObservations(): Promise<BuoyReadingRow[]> {
  const obsApiKey = process.env.OBSCOSTEIRO_API_KEY || '';

  // Fetch both sources in parallel
  const [portusResults, obsResults] = await Promise.all([
    Promise.allSettled(RIAS_BUOY_STATIONS.map(fetchPortusStation)),
    obsApiKey
      ? Promise.allSettled(OBS_STATIONS.map((s) => fetchObsStation(s, obsApiKey)))
      : Promise.resolve([]),
  ]);

  const portus = (portusResults as PromiseSettledResult<BuoyReadingRow | null>[])
    .filter((r): r is PromiseFulfilledResult<BuoyReadingRow | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((r): r is BuoyReadingRow => r != null);

  const obs = (obsResults as PromiseSettledResult<BuoyReadingRow | null>[])
    .filter((r): r is PromiseFulfilledResult<BuoyReadingRow | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((r): r is BuoyReadingRow => r != null);

  const merged = mergeBuoyReadings(portus, obs);

  const portusCount = portus.length;
  const obsCount = obs.length;
  log.info(`Buoys: PORTUS ${portusCount}/12, ObsCosteiro ${obsCount}/6 → ${merged.length} merged`);

  return merged;
}
