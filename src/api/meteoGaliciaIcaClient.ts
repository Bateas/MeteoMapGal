/**
 * MeteoGalicia ICA (Índice de Calidade do Aire) client.
 *
 * Official Xunta de Galicia air-quality network: ~46 stations reporting
 * hourly. Read from MeteoGalicia's official JSON service
 * (`mgrss/caire/jsonICAActual.action`, doc IT/052 on their RSS/JSON page).
 * Until v2.178.23 it read the ESRI map layer of their web viewer (IDEG,
 * `METEO2_WS/Observacion_Predicion_Calidad_Aire`), which MeteoGalicia told us
 * on 9-oct is not for third-party apps. Checked side by side on 12-oct: the
 * same 46 stations with the same category, pollutant and hour; the index comes
 * rounded to two decimals (at most 0.04 apart) and the positions differ by up
 * to ~1 km between the two sources (irrelevant for a regional index).
 *
 * ICA scale (documented): a decimal 0-6. 0-1 Buena, 1-2 Adecuada/Favorable,
 * 2-3 Regular, 3-4 Mala, 4-5 Muy mala, 5-6 Pésima.
 *
 * Each reading also reports the limiting pollutant (`maximo`): O3, NO2,
 * PM10, PM25, SO2, CO, BEN.
 */
import { parseMadridWallTime } from '../services/localTime';
import { SERVER_USER_AGENT } from '../config/serverIdentity';

const PATH = '/mgrss/caire/jsonICAActual.action';
/** The service, as the server that stores the readings asks for it. */
const DIRECT_ENDPOINT = `https://servizos.meteogalicia.gal${PATH}`;
/** The same service through our own MeteoGalicia proxy, which caches it for everyone. */
const PROXIED_ENDPOINT = `/meteogalicia-api${PATH}`;

/**
 * Where to ask, depending on who is asking.
 *
 * This module has two callers: the browser and the service that stores the
 * readings. From the browser it goes through our own path, so a thousand
 * visitors cost MeteoGalicia one request per cache window. From the service
 * there is no proxy to go through and a relative url does not even parse, so
 * it asks directly.
 */
export function icaEndpoint(inBrowser: boolean): string {
  return inBrowser ? PROXIED_ENDPOINT : DIRECT_ENDPOINT;
}

const ENDPOINT = icaEndpoint(typeof window !== 'undefined');

export type IcaCategory = 'buena' | 'aceptable' | 'deficiente' | 'mala' | 'muy_mala' | 'unknown';

export interface IcaReading {
  station: string;
  /** Decimal value 0-6 (see the scale above). Bucket via icaCategory() */
  ica: number;
  /** Pollutant driving the index (O3, NO2, PM10, PM25, etc) */
  dominantPollutant: string;
  /** Spanish category label from the source */
  categoryEs: string;
  /** Hex color from the source */
  color: string;
  lat: number;
  lon: number;
  timestamp: Date;
}

/**
 * Parse a jsonICAActual.action body: `{icas: [{fecha ("YYYY-MM-DD HH:MM",
 * Madrid local time, no offset), estacion, ica, icaEs, color, maximo,
 * latitud, longitud (strings), ...}]}`. Keeps the freshest record per station;
 * drops records without a number for the index, a position or a valid time.
 */
export function parseIcaActual(body: unknown): IcaReading[] {
  const list = (body as { icas?: unknown } | null)?.icas;
  if (!Array.isArray(list)) return [];
  const byStation = new Map<string, IcaReading>();
  for (const raw of list) {
    const a = raw as Record<string, unknown> | null;
    if (!a || typeof a.estacion !== 'string' || !a.estacion) continue;
    if (typeof a.ica !== 'number' || !Number.isFinite(a.ica)) continue;
    const lat = Number(a.latitud);
    const lon = Number(a.longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const t = typeof a.fecha === 'string' ? parseMadridWallTime(a.fecha) : NaN;
    if (!Number.isFinite(t)) continue;
    const prev = byStation.get(a.estacion);
    if (prev && prev.timestamp.getTime() >= t) continue;
    byStation.set(a.estacion, {
      station: a.estacion,
      ica: a.ica,
      dominantPollutant: typeof a.maximo === 'string' ? a.maximo : '',
      categoryEs: typeof a.icaEs === 'string' ? a.icaEs : '',
      color: typeof a.color === 'string' ? a.color : '#94a3b8',
      lat,
      lon,
      timestamp: new Date(t),
    });
  }
  return [...byStation.values()];
}

/**
 * Fetch the latest ICA observation for every reporting station, telling a failure from an
 * empty answer: an HTTP error, a body that is not JSON or a JSON without the `icas` list
 * THROWS with the reason; `[]` only means MeteoGalicia answered and listed nothing usable.
 * The service that stores the readings uses this one, so a cut of the source shows in its log
 * instead of reading as «0 observations» forever.
 */
export async function fetchIcaObservationsChecked(): Promise<IcaReading[]> {
  // From the server, say who we are (serverIdentity.ts); a browser does not let a page set it.
  const headers = typeof window === 'undefined' ? { 'User-Agent': SERVER_USER_AGENT } : undefined;
  const res = await fetch(ENDPOINT, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    const type = res.headers.get('content-type') ?? 'sin content-type';
    throw new Error(`answer is not JSON (${type}, ${text.length} bytes)`);
  }
  if (!Array.isArray((body as { icas?: unknown } | null)?.icas)) {
    throw new Error('JSON without the `icas` list');
  }
  return parseIcaActual(body);
}

/** Fetch the latest ICA observation for every reporting station; `[]` on any failure (map use). */
export async function fetchIcaObservations(): Promise<IcaReading[]> {
  try {
    return await fetchIcaObservationsChecked();
  } catch (err) {
    console.debug('[MG ICA] fetch/parse failed', err);
    return [];
  }
}

/**
 * Map the decimal ICA to a discrete category. These bands date from when we
 * read the index as 1-5; the documented scale is 0-6 (see the header), so they
 * sit about half a band high. Kept as they are in this change (same data,
 * same bands); reviewing them changes when the ticker names a station.
 */
export function icaCategory(value: number): IcaCategory {
  if (!Number.isFinite(value)) return 'unknown';
  if (value < 1.5) return 'buena';
  if (value < 2.5) return 'aceptable';
  if (value < 3.5) return 'deficiente';
  if (value < 4.5) return 'mala';
  return 'muy_mala';
}
