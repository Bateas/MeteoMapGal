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
import { readObsCurrent, type ObsResponse } from '../src/api/obsCosteiroParse.js';
import { portusFechaToIso } from '../src/api/portusTime.js';
import { shouldAskPortus, isBackingOff, nextPortusBackoff, type PortusBackoff } from './portusBackoff.js';

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
  // Not asked to PORTUS any more: since 20-sep PORTUS answers HTTP 500 whenever
  // AIR_PRESSURE is requested for it, and without that category it only returns
  // air temperature (water temperature comes null). Its water, air and humidity
  // arrive through ObsCosteiro (same buoy, same id). If it is ever re-enabled,
  // do not ask for AIR_PRESSURE.
  { id: 1251, name: 'Rande (Ría Vigo)', type: 'CETMAR', enabled: false,
    categories: ['WATER_TEMP', 'AIR_TEMP'] },
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
// the audit observation of upstream publishing cadences. Cycle-end
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

// 6 hours. The "fecha was 2.5-5 h old" that once justified it was OUR clock:
// PORTUS sends UTC with no zone and we read it as Madrid time (see
// portusTime.ts). The data is near real-time — REDMAR minutes, Silleiro
// (REDEXT) hourly — so this only catches genuinely stuck buoys (like Cíes in
// Dec 2025, gated separately) and could be tightened once the fix has run.
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
 * on the lesson where buoys 2248 + 3223 went silently dead for 40
 * days because the global empty-cycles counter never tripped (other
 * stations were still reporting).
 *
 * Map: station_id → epoch ms of last successful read.
 * Initial state is empty after restart — first cycle skips the check
 * (any station that didn't appear yet is "unseen", not "stale").
 */
const buoyLastSeen = new Map<number, number>();

/** PORTUS stations that keep failing: asked once an hour (portusBackoff.ts). */
const portusBackoff = new Map<number, PortusBackoff>();

function madridHhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
}

/** Records whether a PORTUS request failed and logs only when a station enters or leaves the pause. */
function notePortusAnswer(station: BuoyStation, failed: boolean, nowMs = Date.now()): void {
  const before = portusBackoff.get(station.id);
  const after = nextPortusBackoff(before, failed, nowMs);
  if (after) portusBackoff.set(station.id, after);
  else portusBackoff.delete(station.id);
  if (!isBackingOff(before) && isBackingOff(after)) {
    log.warn(`PORTUS ${station.name} (${station.id}) falla en ${after!.fails} ciclos seguidos desde las ${madridHhmm(after!.since)}: se le pregunta una vez por hora hasta que responda`);
  } else if (isBackingOff(before) && !after) {
    log.info(`PORTUS ${station.name} (${station.id}) vuelve a responder: se le pregunta cada ciclo`);
  }
}

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
      // A station already known to be failing gets no retry: its hourly probe is enough.
      if ((res.status >= 500 || res.status === 429) && !isBackingOff(portusBackoff.get(station.id))) {
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
          notePortusAnswer(station, true);
          return null;
        }
        notePortusAnswer(station, false);
        const retryData = await retry.json();
        return parsePortusResponse(station, retryData);
      }
      notePortusAnswer(station, true);
      return null;
    }

    notePortusAnswer(station, false);
    const data = await res.json();
    return parsePortusResponse(station, data);
  } catch (err) {
    notePortusAnswer(station, true);
    log.warn(`PORTUS ${station.name} (${station.id}): ${(err as Error).message}`);
    return null;
  }
}

export function parsePortusResponse(
  station: BuoyStation,
  data: { fecha?: string; datos?: any[] }
): BuoyReadingRow | null {
  // diagnostic: log WHY a station returns null. Three reasons:
  //   - empty payload (no datos array, no fecha)
  //   - stale data (fecha older than MAX_AGE_MS)
  //   - parsed OK but no recognized parameters (rare)
  // Aggregating these in the cycle counter using synthetic status codes
  // outside the HTTP range (-1 = empty, -2 = stale, -3 = no params).
  // `fecha` is UTC without a zone: stored as-is, Postgres (session in
  // Europe/Madrid) filed every reading 2 h early. Always go through the parser.
  const fechaIso = portusFechaToIso(data?.fecha);
  if (!data?.datos?.length || !fechaIso) {
    portusFailureCounters.set(-1, (portusFailureCounters.get(-1) ?? 0) + 1);
    return null;
  }

  // Check freshness
  const age = Date.now() - Date.parse(fechaIso);
  if (age > MAX_AGE_MS) {
    portusFailureCounters.set(-2, (portusFailureCounters.get(-2) ?? 0) + 1);
    return null;
  }

  const row: BuoyReadingRow = {
    time: fechaIso,
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

// Field selection (10-minute window, sensor height, per-field time) lives in
// the pure parser shared with the frontend client: src/api/obsCosteiroParse.ts.

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

export function parseObsResponse(station: ObsStation, data: ObsResponse): BuoyReadingRow | null {
  const cur = readObsCurrent(data);
  if (!cur) return null;

  const age = Date.now() - new Date(cur.time).getTime();
  if (age > MAX_AGE_MS) return null;

  return {
    time: cur.time,
    stationId: station.canonicalId,
    stationName: station.name,
    source: 'obscosteiro',
    waveHeight: null, waveHeightMax: null, wavePeriod: null,
    wavePeriodMean: null, waveDir: null,
    windSpeed: cur.windSpeed,
    windDir: cur.windDir,
    windGust: cur.windGust,
    waterTemp: cur.waterTemp,
    airTemp: cur.airTemp,
    airPressure: null,
    currentSpeed: null, currentDir: null,
    salinity: cur.salinity,
    seaLevel: null,
    humidity: cur.humidity,
    dewPoint: cur.dewPoint,
  };
}

// ── Merge logic ─────────────────────────────────────────

/** The Xunta row stays the base unless PORTUS is newer by more than this. */
const OBS_BASE_WINDOW_MS = 20 * 60_000;
/** A field is only borrowed from the other source within this of the base. */
const MERGE_FILL_MAX_MS = 90 * 60_000;

const MERGE_FIELDS = [
  'waveHeight', 'waveHeightMax', 'wavePeriod', 'wavePeriodMean', 'waveDir',
  'windSpeed', 'windDir', 'windGust', 'waterTemp', 'airTemp', 'airPressure',
  'currentSpeed', 'currentDir', 'salinity', 'seaLevel', 'humidity', 'dewPoint',
] as const satisfies readonly (keyof BuoyReadingRow)[];

/**
 * One row per platform that both PORTUS and the Xunta report (Cortegada,
 * A Guarda, Ribeira, Rande). The Xunta row is the base — 10-minute values
 * with validation codes, plus humidity and dew point — unless PORTUS is
 * clearly newer; either way, every field the base lacks is filled from the
 * other source when that reading is close in time, so neither side's data is
 * lost. Until the PORTUS clock was fixed the PORTUS row always looked 2 h
 * older, so the Xunta always won; with true times it may not, and the old
 * one-way fill would have dropped the Xunta's humidity and flipped the
 * row's source label.
 */
export function mergeBuoyReadings(portus: BuoyReadingRow[], obs: BuoyReadingRow[]): BuoyReadingRow[] {
  const map = new Map<number, BuoyReadingRow>();

  for (const r of portus) map.set(r.stationId, r);

  for (const obsR of obs) {
    const portusR = map.get(obsR.stationId);

    if (!portusR) {
      // New station (Muros)
      map.set(obsR.stationId, obsR);
      continue;
    }

    const portusTime = Date.parse(portusR.time);
    const obsTime = Date.parse(obsR.time);
    const portusClearlyNewer = portusTime - obsTime > OBS_BASE_WINDOW_MS;
    const base = portusClearlyNewer ? portusR : obsR;
    const other = portusClearlyNewer ? obsR : portusR;
    const merged: BuoyReadingRow = { ...base };
    if (Math.abs(portusTime - obsTime) <= MERGE_FILL_MAX_MS) {
      for (const k of MERGE_FIELDS) {
        if (merged[k] == null && other[k] != null) merged[k] = other[k];
      }
    }
    map.set(obsR.stationId, merged);
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

  // Concurrency caps — PORTUS rate-limits aggressively per IP. The
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
  // Stations failing for three cycles in a row wait for their hourly probe (portusBackoff.ts).
  const cycleNow = Date.now();
  const portusAsked = portusStations.filter((s) => shouldAskPortus(portusBackoff.get(s.id), cycleNow));
  const portusWaiting = portusStations.filter((s) => !portusAsked.includes(s));

  // Reset the per-cycle failure counter before we start fetching.
  portusFailureCounters.clear();

  // Fetch both sources in parallel
  const [portusResults, obsResults] = await Promise.all([
    allSettledLimit(portusAsked, fetchPortusStation, PORTUS_CONCURRENCY),
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
  const waitingNote = portusWaiting.length > 0
    ? ` · en espera (1/h): ${portusWaiting.map((s) => `${s.name} ${s.id}`).join(', ')}`
    : '';
  log.info(`Buoys: PORTUS ${portusCount}/${portusEnabled}, ObsCosteiro ${obsCount}/${obsEnabled} → ${merged.length} merged${waitingNote}`);

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

  // Per-station freshness check. Closes the lesson: the global
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
