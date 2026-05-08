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
import { allSettledLimit } from './concurrency.js';

const PORTUS_BASE = 'https://portus.puertos.es/portussvr/api';
const OBS_BASE = 'https://apis-ext.xunta.gal/mgplatpubapi/v1/api';
const TIMEOUT = 20_000;

// ── Station definitions ─────────────────────────────────

interface BuoyStation {
  id: number;
  name: string;
  type: string;
  /**
   * Custom PORTUS categories list. Default (undefined) uses all 7. Override
   * for stations that don't have certain sensors — saves a wasted parse and
   * removes them from the "empty" failure counter. Rande for example has
   * no anemometer (documented gotcha), so requesting WAVE+WIND always
   * returns nothing relevant for our row shape.
   */
  categories?: string[];
}

const RIAS_BUOY_STATIONS: (BuoyStation & { enabled?: boolean })[] = [
  // Exterior
  { id: 2248, name: 'Cabo Silleiro', type: 'REDEXT' },
  { id: 1253, name: 'A Guarda', type: 'CETMAR' },
  // Ría de Vigo
  { id: 1252, name: 'Islas Cíes', type: 'CETMAR', enabled: false },  // OFFLINE since Dec 2025 (same as ObsCosteiro 15002)
  // Rande has NO anemometer (documented gotcha) — only humidity/temp/dewpoint.
  // Asking PORTUS for WAVE+WIND always returns "empty" from our parser's
  // perspective. Requesting only the relevant categories cleans the logs.
  { id: 1251, name: 'Rande (Ría Vigo)', type: 'CETMAR',
    categories: ['WATER_TEMP', 'AIR_TEMP', 'AIR_PRESSURE'] },
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

// Per-type expected "stale-after" thresholds in minutes. Calibrated from
// the S135+2 audit observation of upstream publishing cadences. Cycle-end
// check in fetchBuoyObservations() compares each enabled station's last-
// seen timestamp against its type's threshold and warns if exceeded.
const STALE_AFTER_MIN: Record<string, number> = {
  CETMAR: 90,        // PORTUS coastal moored — 30-60min cadence + slack
  REDEXT: 90,        // Oceanic moored — 30min cadence + slack
  REDMAR: 60,        // Tide gauges with met — 10-15min cadence + slack
  REMPOR: 60,        // Port stations — 15min cadence + slack
  OBSCOSTEIRO: 30,   // Xunta API — 10min cadence + slack
};

interface ObsStation {
  obsId: number;
  canonicalId: number;
  name: string;
}

// `enabled: false` skips polling without removing the row — flip back when
// the station returns to service (no diff in IDs/maps elsewhere).
const OBS_STATIONS: (ObsStation & { enabled?: boolean })[] = [
  { obsId: 15001, canonicalId: 1250, name: 'Cortegada (Arousa)' },
  { obsId: 15002, canonicalId: 1252, name: 'Islas Cíes', enabled: false },     // OFFLINE since Dec 2025
  { obsId: 15004, canonicalId: 1253, name: 'A Guarda' },
  { obsId: 15005, canonicalId: 1255, name: 'Ribeira' },
  { obsId: 15100, canonicalId: 1251, name: 'Rande (Ría Vigo)' },
  { obsId: 15009, canonicalId: 15009, name: 'Muros' },          // NEW — no PORTUS equivalent
];

const NO_DATA = -9999;
// 6 hours, not 2: PORTUS publishes oceanic-mooring buoys (REDEXT) and tide-
// gauge meteorology (REDMAR) with cadences of 1-3 hours, not minutes. The
// S135+2 audit caught us silently rejecting 9 of 11 PORTUS stations every
// cycle because the "fecha" was 2.5-5 h old — by upstream design, not bug.
// 6 h is generous enough to keep all working stations through, while still
// catching genuinely stuck buoys (like Cíes in Dec 2025, gated separately).
const MAX_AGE_MS = 6 * 60 * 60_000;

/**
 * HTTP status code → count for the current cycle. fetchPortusStation
 * increments this on every non-OK response. fetchBuoyObservations
 * resets it before fetching and prints a cycle summary at the end.
 * This gives one informative line per cycle instead of N×11 noisy
 * per-station warnings.
 */
const portusFailureCounters = new Map<number, number>();

/**
 * Per-station last-seen tracker. Updated every cycle from the readings
 * actually returned this cycle. Compared against STALE_AFTER_MIN at end
 * of cycle to detect upstream regressions per-station — closes the loop
 * on the S135+2 lesson where buoys 2248 + 3223 went silently dead for 40
 * days because the global empty-cycles counter never tripped (other
 * stations were still reporting).
 *
 * Map: station_id → epoch ms of last successful read.
 * Initial state is empty after restart — first cycle skips the check
 * (any station that didn't appear yet is "unseen", not "stale").
 */
const buoyLastSeen = new Map<number, number>();

// ── PORTUS fetch ────────────────────────────────────────

async function fetchPortusStation(station: BuoyStation): Promise<BuoyReadingRow | null> {
  // Defensive guard — IDs >= 15000 belong to ObsCosteiro, not PORTUS.
  // Puertos del Estado emailed warning of IP block when this leaked.
  if (station.id >= 15000) {
    log.warn(`PORTUS fetch refused for ObsCosteiro id ${station.id} — use OBS_STATIONS path`);
    return null;
  }
  try {
    // Use station-specific categories if defined (e.g. Rande has no anemometer),
    // otherwise the default full list.
    const categories = station.categories ?? [
      'WAVE', 'WIND', 'WATER_TEMP', 'AIR_TEMP', 'SEA_LEVEL', 'CURRENTS', 'SALINITY',
    ];
    // Browser-style User-Agent. Default Node fetch sends an empty UA which
    // some upstreams (incl. PORTUS) treat as "bot" and rate-limit harder.
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; MeteoMapGal/1.0; +https://meteomapgal.navia3d.com)',
    };
    const res = await fetch(`${PORTUS_BASE}/lastData/station/${station.id}?locale=es`, {
      method: 'POST',
      headers,
      body: JSON.stringify(categories),
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (!res.ok) {
      // Aggregate the status code into a module-level counter so the cycle
      // summary log can say "11 failed: 9× 429, 2× 503" — quieter than
      // 11 separate warn lines per cycle but still actionable.
      // (See logCycleSummary() at the end of fetchBuoyObservations.)
      portusFailureCounters.set(res.status, (portusFailureCounters.get(res.status) ?? 0) + 1);
      if (res.status >= 500 || res.status === 429) {
        // Retry on 5xx or 429 with longer backoff (PORTUS rate-limit window
        // appears to be ~30-60s based on observed behaviour).
        await new Promise((r) => setTimeout(r, 5000));
        const retry = await fetch(`${PORTUS_BASE}/lastData/station/${station.id}?locale=es`, {
          method: 'POST',
          headers,
          body: JSON.stringify(categories),
          signal: AbortSignal.timeout(TIMEOUT),
        });
        if (!retry.ok) {
          portusFailureCounters.set(retry.status, (portusFailureCounters.get(retry.status) ?? 0) + 1);
          return null;
        }
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
  // S135+2 diagnostic: log WHY a station returns null. Three reasons:
  //   - empty payload (no datos array, no fecha)
  //   - stale data (fecha older than MAX_AGE_MS)
  //   - parsed OK but no recognized parameters (rare)
  // Aggregating these in the cycle counter using synthetic status codes
  // outside the HTTP range (-1 = empty, -2 = stale, -3 = no params).
  if (!data?.datos?.length || !data.fecha) {
    portusFailureCounters.set(-1, (portusFailureCounters.get(-1) ?? 0) + 1);
    return null;
  }

  // Check freshness
  const age = Date.now() - new Date(data.fecha).getTime();
  if (age > MAX_AGE_MS) {
    portusFailureCounters.set(-2, (portusFailureCounters.get(-2) ?? 0) + 1);
    return null;
  }

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

  // Concurrency caps — PORTUS rate-limits aggressively per IP. The S135+2
  // audit revealed buoys 2248 and 3223 had been silently dead for 40 days
  // because the 12-way Promise.allSettled fan-out had most stations losing
  // the race for PORTUS's connection budget.
  //
  // v2.79.6 set PORTUS=2; logs still showed 0-1/12 success per cycle.
  // v2.79.8 drops to PORTUS=1 (fully sequential) since manual curl from
  // the same IP works fine — the issue is concurrent-connections-from-
  // same-IP, not total request volume. Sequential gives every station
  // ~1.5s per attempt with the 5s backoff on 429 (~25-30s per cycle for
  // 11 stations, fits within the 5min poll window).
  const PORTUS_CONCURRENCY = 1;
  const OBS_CONCURRENCY = 3;

  const portusStations = RIAS_BUOY_STATIONS.filter((s) => s.enabled !== false);
  const obsStations = OBS_STATIONS.filter((s) => s.enabled !== false);

  // Reset the per-cycle failure counter before we start fetching.
  portusFailureCounters.clear();

  // Fetch both sources in parallel
  const [portusResults, obsResults] = await Promise.all([
    allSettledLimit(portusStations, fetchPortusStation, PORTUS_CONCURRENCY),
    obsApiKey
      ? allSettledLimit(obsStations, (s) => fetchObsStation(s, obsApiKey), OBS_CONCURRENCY)
      : Promise.resolve([] as PromiseSettledResult<BuoyReadingRow | null>[]),
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
  const portusEnabled = portusStations.length;
  const obsEnabled = obsStations.length;
  log.info(`Buoys: PORTUS ${portusCount}/${portusEnabled}, ObsCosteiro ${obsCount}/${obsEnabled} → ${merged.length} merged`);

  // Diagnostic: when PORTUS gives < total back, surface WHY. Distinguishes:
  //   HTTP 429/403/5xx — upstream rejecting at network layer
  //   -1 empty        — 200 OK but no `datos` array or no `fecha`
  //   -2 stale        — 200 OK but fecha older than MAX_AGE_MS (2h)
  // This is what makes "PORTUS 1/12" actionable instead of opaque.
  if (portusFailureCounters.size > 0) {
    const codeLabel = (code: number): string => {
      if (code === -1) return 'empty';
      if (code === -2) return 'stale';
      if (code === -3) return 'no-params';
      return String(code);
    };
    const breakdown = Array.from(portusFailureCounters.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([code, count]) => `${count}× ${codeLabel(code)}`)
      .join(', ');
    log.warn(`PORTUS rejections this cycle: ${breakdown}`);
  }

  // Per-station freshness check. Closes the S135+2 lesson: the global
  // "consecutiveEmptyBuoyCycles" counter (v2.79.5) only fires when ALL
  // stations are silent for 1h+. Individual stations could go dark for
  // weeks and we'd never know — that's exactly how 2248 + 3223 hid.
  //
  // Now: every cycle, update the lastSeen map for stations that returned
  // data, then warn for any station whose lastSeen exceeds the type's
  // expected cadence × buffer.
  const nowMs = Date.now();
  for (const r of merged) {
    buoyLastSeen.set(r.stationId, nowMs);
  }

  const staleStations: string[] = [];
  for (const station of portusStations) {
    const last = buoyLastSeen.get(station.id);
    if (!last) continue; // never seen yet → skip on first cycles after restart
    const ageMin = Math.round((nowMs - last) / 60_000);
    const threshold = STALE_AFTER_MIN[station.type] ?? 90;
    if (ageMin > threshold) {
      staleStations.push(`${station.name} ${ageMin}m (>${threshold}m for ${station.type})`);
    }
  }
  for (const station of obsStations) {
    const last = buoyLastSeen.get(station.canonicalId);
    if (!last) continue;
    const ageMin = Math.round((nowMs - last) / 60_000);
    const threshold = STALE_AFTER_MIN.OBSCOSTEIRO;
    if (ageMin > threshold) {
      staleStations.push(`${station.name} ${ageMin}m (>${threshold}m OBSCOSTEIRO)`);
    }
  }

  if (staleStations.length > 0) {
    log.warn(`[Buoys] per-station stale: ${staleStations.join(' | ')}`);
  }

  return merged;
}
