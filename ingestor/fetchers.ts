/**
 * Observation fetchers — server-side fetch of current readings from all 5 sources.
 * Calls APIs directly (no proxy), normalizes with shared normalizer functions.
 */

import type { NormalizedStation, NormalizedReading } from '../src/types/station.js';
import type { AemetApiResponse, AemetRawObservation } from '../src/types/aemet.js';
import type { MeteoGaliciaObsResponse } from '../src/types/meteogalicia.js';
import type { MeteoclimaticRawStation } from '../src/types/meteoclimatic.js';
import { METEOCLIMATIC_STATIONS } from '../src/types/meteoclimatic.js';
import {
  normalizeAemetObservation,
  normalizeMeteoGaliciaObservation,
  normalizeMeteoclimaticObservation,
} from '../src/services/normalizer.js';
import { parseMeteoclimaticXml } from './xml.js';
import { getNetatmoToken } from './discover.js';
import { log } from './logger.js';

const AEMET_BASE = 'https://opendata.aemet.es/opendata';
const MG_BASE = 'https://servizos.meteogalicia.gal';
const MC_BASE = 'https://www.meteoclimatic.net';
const WU_BASE = 'https://api.weather.com';
const NETATMO_API = 'https://app.netatmo.net';

const TIMEOUT = 15_000;

// ── AEMET observations ───────────────────────────────

async function fetchAemet(
  stationIds: Set<string>
): Promise<NormalizedReading[]> {
  const apiKey = process.env.AEMET_API_KEY;
  if (!apiKey || stationIds.size === 0) return [];

  try {
    // Step 1: metadata URL
    const metaRes = await fetch(
      `${AEMET_BASE}/api/observacion/convencional/todas?api_key=${apiKey}`,
      { signal: AbortSignal.timeout(TIMEOUT) }
    );

    if (metaRes.status === 429) {
      log.warn('AEMET rate-limited (429), skipping this cycle');
      return [];
    }

    const meta: AemetApiResponse = await metaRes.json();
    if (meta.estado !== 200 || !meta.datos) {
      log.warn('AEMET obs: unexpected status', meta.estado);
      return [];
    }

    // Step 2: actual data (ISO-8859-1 charset)
    const dataRes = await fetch(meta.datos, { signal: AbortSignal.timeout(TIMEOUT) });
    const buf = await dataRes.arrayBuffer();
    const charset = dataRes.headers.get('content-type')?.match(/charset=([^\s;]+)/i)?.[1] ?? 'iso-8859-1';
    const text = new TextDecoder(charset).decode(buf);
    const rawObs: AemetRawObservation[] = JSON.parse(text);

    // Filter to our stations only
    const readings = rawObs
      .filter((o) => stationIds.has(`aemet_${o.idema}`))
      .map(normalizeAemetObservation);

    log.info(`AEMET: ${readings.length} readings`);
    return readings;
  } catch (err) {
    log.error('AEMET fetch failed:', (err as Error).message);
    return [];
  }
}

// ── MeteoGalicia observations ────────────────────────

async function fetchMeteoGalicia(
  stations: NormalizedStation[]
): Promise<NormalizedReading[]> {
  const mgStations = stations.filter((s) => s.source === 'meteogalicia');
  if (mgStations.length === 0) return [];

  const results = await Promise.allSettled(
    mgStations.map(async (station) => {
      const numId = station.id.replace('mg_', '');
      const res = await fetch(
        `${MG_BASE}/mgrss/observacion/ultimos10minEstacionsMeteo.action?idEst=${numId}`,
        { signal: AbortSignal.timeout(TIMEOUT) }
      );
      const data: MeteoGaliciaObsResponse = await res.json();
      const entries = data.listUltimos10min ?? [];
      if (entries.length === 0) return null;

      // Take latest entry
      const entry = entries[0];
      return normalizeMeteoGaliciaObservation(parseInt(numId, 10), entry);
    })
  );

  const readings = results
    .filter((r): r is PromiseFulfilledResult<NormalizedReading | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((r): r is NormalizedReading => r !== null);

  log.info(`MeteoGalicia: ${readings.length}/${mgStations.length} readings`);
  return readings;
}

// ── Meteoclimatic observations ───────────────────────

async function fetchMeteoclimatic(
  stationIds: Set<string>
): Promise<NormalizedReading[]> {
  if (stationIds.size === 0) return [];

  const regions = ['ESGAL32', 'ESGAL36'];
  const allRaw: MeteoclimaticRawStation[] = [];

  const results = await Promise.allSettled(
    regions.map(async (region) => {
      const res = await fetch(
        `${MC_BASE}/feed/xml/${region}`,
        { signal: AbortSignal.timeout(TIMEOUT) }
      );
      const xml = await res.text();
      return parseMeteoclimaticXml(xml);
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allRaw.push(...result.value);
    }
  }

  // Dedup by station ID, filter to our stations, require known coords
  const seen = new Set<string>();
  const readings: NormalizedReading[] = [];

  for (const raw of allRaw) {
    const id = `mc_${raw.id}`;
    if (seen.has(id) || !stationIds.has(id)) continue;
    seen.add(id);

    // Verify coordinates exist in our metadata
    const meta = METEOCLIMATIC_STATIONS.find((m) => m.id === raw.id);
    if (!meta) continue;

    readings.push(normalizeMeteoclimaticObservation(raw));
  }

  log.info(`Meteoclimatic: ${readings.length} readings`);
  return readings;
}

// ── Weather Underground observations ─────────────────

interface WUObservation {
  stationID: string;
  obsTimeUtc: string;
  lat: number;
  lon: number;
  winddir: number | null;
  humidity: number | null;
  solarRadiation: number | null;
  metric_si: {
    temp: number | null;
    windSpeed: number | null;
    windGust: number | null;
    pressure: number | null;
    precipTotal: number | null;
    dewpt: number | null;
  };
}

async function fetchWunderground(
  stations: NormalizedStation[]
): Promise<NormalizedReading[]> {
  const wuStations = stations.filter((s) => s.source === 'wunderground');
  if (wuStations.length === 0) return [];

  const apiKey = process.env.WU_API_KEY || 'e1f10a1e78da46f5b10a1e78da96f525';
  const readings: NormalizedReading[] = [];

  const results = await Promise.allSettled(
    wuStations.map(async (station) => {
      const rawId = station.id.replace('wu_', '');
      const res = await fetch(
        `${WU_BASE}/v2/pws/observations/current?stationId=${rawId}&format=json&units=s&apiKey=${apiKey}`,
        { signal: AbortSignal.timeout(TIMEOUT) }
      );
      const data = await res.json();
      const obs: WUObservation[] = data.observations ?? [];
      if (obs.length === 0) return null;

      const o = obs[0];
      const m = o.metric_si;
      const reading: NormalizedReading = {
        stationId: station.id,
        timestamp: new Date(o.obsTimeUtc),
        windSpeed: m.windSpeed,
        windGust: m.windGust,
        windDirection: o.winddir,
        temperature: m.temp,
        humidity: o.humidity,
        precipitation: m.precipTotal,
        solarRadiation: o.solarRadiation,
        pressure: m.pressure,
        dewPoint: m.dewpt,
      };
      return reading;
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      readings.push(result.value);
    }
  }

  log.info(`Weather Underground: ${readings.length}/${wuStations.length} readings`);
  return readings;
}

// ── Netatmo observations ─────────────────────────────

interface NetatmoMeasure {
  res?: Record<string, number[]>;
  type?: string[];
  wind_strength?: number;
  wind_angle?: number;
  gust_strength?: number;
  wind_timeutc?: number;
  rain_60min?: number;
}

interface NetatmoRawStation {
  _id: string;
  place: { location: [number, number]; altitude: number; city?: string };
  measures: Record<string, NetatmoMeasure>;
  module_types?: Record<string, string>;
}

async function fetchNetatmo(
  stations: NormalizedStation[]
): Promise<NormalizedReading[]> {
  const ntStations = stations.filter((s) => s.source === 'netatmo');
  if (ntStations.length === 0) return [];

  const token = await getNetatmoToken();
  if (!token) return [];

  // Build a lookup of our station IDs for filtering
  const stationMacs = new Map<string, NormalizedStation>();
  for (const s of ntStations) {
    // Extract short MAC from station ID
    const shortMac = s.id.replace('nt_', '');
    stationMacs.set(shortMac, s);
  }

  const readings: NormalizedReading[] = [];

  // Fetch for each sector bbox
  for (const sector of (await import('../src/config/sectors.js')).SECTORS) {
    const [lon, lat] = sector.center;
    const latDelta = (sector.radiusKm / 111) * 1.1;
    const lonDelta = (sector.radiusKm / 82) * 1.1;

    try {
      // Fetch wind stations
      const res = await fetch(`${NETATMO_API}/api/getpublicdata`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lat_ne: lat + latDelta,
          lat_sw: lat - latDelta,
          lon_ne: lon + lonDelta,
          lon_sw: lon - lonDelta,
          required_data: 'wind',
          filter: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const data = await res.json();
      const body: NetatmoRawStation[] = data.body ?? [];

      for (const raw of body) {
        const shortMac = raw._id.replace(/:/g, '').slice(-6).toLowerCase();
        const station = stationMacs.get(shortMac);
        if (!station) continue;

        // Already processed this station?
        if (readings.some((r) => r.stationId === station.id)) continue;

        // Extract measurements
        let temperature: number | null = null;
        let humidity: number | null = null;
        let pressure: number | null = null;
        let windSpeed: number | null = null;
        let windDirection: number | null = null;
        let windGust: number | null = null;
        let rain: number | null = null;
        let timestamp = new Date();

        for (const measure of Object.values(raw.measures)) {
          // Wind data (from NAModule2)
          if (measure.wind_strength != null) {
            windSpeed = measure.wind_strength / 3.6; // km/h → m/s
            windDirection = measure.wind_angle !== -1 ? (measure.wind_angle ?? null) : null;
            windGust = measure.gust_strength != null ? measure.gust_strength / 3.6 : null;
            if (measure.wind_timeutc) {
              timestamp = new Date(measure.wind_timeutc * 1000);
            }
          }

          // Rain
          if (measure.rain_60min != null) {
            rain = measure.rain_60min;
          }

          // Temperature, humidity, pressure from res/type arrays
          if (measure.res && measure.type) {
            const entries = Object.entries(measure.res);
            if (entries.length > 0) {
              const [ts, values] = entries[entries.length - 1];
              const measTime = new Date(parseInt(ts, 10) * 1000);
              if (measTime > timestamp) timestamp = measTime;

              for (let i = 0; i < measure.type.length; i++) {
                const val = values[i];
                if (val == null) continue;
                switch (measure.type[i]) {
                  case 'temperature': temperature = val; break;
                  case 'humidity': humidity = val; break;
                  case 'pressure': pressure = val; break;
                }
              }
            }
          }
        }

        readings.push({
          stationId: station.id,
          timestamp,
          windSpeed,
          windGust,
          windDirection,
          temperature,
          humidity,
          precipitation: rain,
          solarRadiation: null,
          pressure,
          dewPoint: null,
        });
      }
    } catch (err) {
      log.error(`Netatmo fetch (${sector.id}) failed:`, (err as Error).message);
    }
  }

  log.info(`Netatmo: ${readings.length} readings`);
  return readings;
}

// ── Orchestrator ──────────────────────────────────────

/**
 * Fetch observations from all 5 sources in parallel.
 * Returns array of NormalizedReading ready for DB insert.
 */
export async function fetchAllObservations(
  stations: Map<string, NormalizedStation>
): Promise<NormalizedReading[]> {
  const stationList = Array.from(stations.values());

  // Build source-specific station ID sets
  const aemetIds = new Set(stationList.filter((s) => s.source === 'aemet').map((s) => s.id));
  const mcIds = new Set(stationList.filter((s) => s.source === 'meteoclimatic').map((s) => s.id));

  const results = await Promise.allSettled([
    fetchAemet(aemetIds),
    fetchMeteoGalicia(stationList),
    fetchMeteoclimatic(mcIds),
    fetchWunderground(stationList),
    fetchNetatmo(stationList),
  ]);

  const allReadings: NormalizedReading[] = [];
  const sourceNames = ['AEMET', 'MeteoGalicia', 'Meteoclimatic', 'WU', 'Netatmo'];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      allReadings.push(...result.value);
    } else {
      log.error(`${sourceNames[i]} fetch rejected:`, result.reason?.message ?? result.reason);
    }
  }

  // Filter out readings with invalid timestamps
  const validReadings = allReadings.filter((r) => {
    if (isNaN(r.timestamp.getTime())) {
      log.warn(`Invalid timestamp for ${r.stationId}, skipping`);
      return false;
    }
    // Skip readings older than 2 hours (stale data)
    const ageMs = Date.now() - r.timestamp.getTime();
    if (ageMs > 2 * 60 * 60_000) {
      return false;
    }
    return true;
  });

  return validReadings;
}
