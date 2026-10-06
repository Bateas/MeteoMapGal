/**
 * METAR client — certified aviation visibility for the Galician airports.
 *
 * Source: aviationweather.gov (NOAA) via the ingestor proxy `/api/v1/metar`
 * (the upstream sends no CORS headers, and the proxy pins the station list
 * server-side). METARs are official observations published every ~30min and
 * they feed the EXISTING regional visibility pipeline (`visibilityReadings`),
 * so the fog halo, the age/distance gates and the multi-evidence fog rules
 * pick them up with zero new UI. LEVX (Vigo/Peinador) matters most: it is
 * the gate of the Ria de Vigo and none of the 8 AEMET vis stations cover it.
 *
 * Format traps (verified live against the API):
 *  - `visib` is usually a STRING in statute miles, possibly with a "+"
 *    suffix ("6+" means 10km or more). Plain numbers are SM, so km = SM x 1.609.
 *  - `obsTime` is epoch SECONDS, not milliseconds.
 *  - `clouds[].base` is in FEET (not used here).
 *  - `rawOb` keeps the raw METAR; a " 9999 " group there means >=10km and is
 *    used ONLY as fallback when `visib` is absent. We never parse rawOb fully.
 *  - Anything unparseable is DISCARDED — a certified source must never be
 *    backfilled with invented numbers.
 */

import type { VisibilityReading } from '../store/weatherStore';
import { parseMetarVisibilityKm } from './metarParse';

export { parseMetarVisibilityKm };

const METAR_ENDPOINT = '/api/v1/metar';
const TIMEOUT_MS = 15_000;

/** Short Spanish display names — the API `name` field is English + verbose. */
const METAR_STATION_NAMES: Record<string, string> = {
  LEVX: 'Vigo/Peinador (METAR)',
  LEST: 'Santiago/Lavacolla (METAR)',
  LECO: 'A Coruña/Alvedro (METAR)',
};

/** Raw station entry from aviationweather.gov (only the fields we read). */
export interface MetarEntry {
  icaoId?: string;
  /** Epoch SECONDS. */
  obsTime?: number;
  /** Statute miles as string ("6+", "3.5") or plain number. */
  visib?: string | number;
  rawOb?: string;
  lat?: number;
  lon?: number;
  name?: string;
}

/**
 * Map the raw API payload to `VisibilityReading[]`. Null-safe on every
 * field: a station missing coords, timestamp or a trustworthy visibility
 * is dropped entirely rather than half-filled.
 */
/**
 * Whether a METAR's PRESENT weather is precipitation without fog. Only the body counts: the trend
 * (TEMPO/BECMG/NOSIG) and remarks are forecast or recent weather (RE...), and «VC» is the vicinity,
 * not the station. Fog or mist reported with the rain (FG/BR) keeps it a fog candidate.
 */
export function metarPrecipWithoutFog(rawOb: string | undefined): boolean {
  if (!rawOb) return false;
  const body = rawOb.split(/\s(?:TEMPO|BECMG|NOSIG|RMK)/)[0];
  const tokens = body.split(/\s+/);
  const precip = tokens.some((t) => /^[+-]?(TS|SH|FZ)?(RA|DZ|SN|SG|GR|GS|PL|UP)+$/.test(t) || /^[+-]?TS(RA|SN|GR|GS|PL)+$/.test(t));
  const fog = tokens.some((t) => /^(MI|BC|PR|FZ)?FG$/.test(t) || t === 'BR');
  return precip && !fog;
}

export function metarToVisibilityReadings(payload: unknown): VisibilityReading[] {
  if (!Array.isArray(payload)) return [];

  // Keep only the newest reading per station — the API normally returns one
  // per id, but a duplicated entry must not let an older METAR win.
  const latestByStation = new Map<string, VisibilityReading>();

  for (const raw of payload) {
    if (raw == null || typeof raw !== 'object') continue;
    const m = raw as MetarEntry;
    if (typeof m.icaoId !== 'string' || m.icaoId === '') continue;
    if (typeof m.lat !== 'number' || !Number.isFinite(m.lat)) continue;
    if (typeof m.lon !== 'number' || !Number.isFinite(m.lon)) continue;
    if (typeof m.obsTime !== 'number' || !Number.isFinite(m.obsTime)) continue;

    const visibility = parseMetarVisibilityKm(m.visib, m.rawOb);
    if (visibility == null) continue;

    const entry: VisibilityReading = {
      stationId: `metar_${m.icaoId}`,
      name: METAR_STATION_NAMES[m.icaoId] ?? `${m.icaoId} (METAR)`,
      lat: m.lat,
      lon: m.lon,
      visibility,
      timestamp: new Date(m.obsTime * 1000), // obsTime is epoch SECONDS
      ...(metarPrecipWithoutFog(m.rawOb) ? { precipitating: true as const } : {}),
    };
    const existing = latestByStation.get(entry.stationId);
    if (!existing || entry.timestamp > existing.timestamp) {
      latestByStation.set(entry.stationId, entry);
    }
  }

  return [...latestByStation.values()];
}

/**
 * Fetch the pinned Galician METARs through the ingestor proxy.
 *
 * Degrades to `[]` in silence on ANY failure: in dev the `/api/v1` proxy
 * points at prod and this route 404s until the ingestor deploy lands, and
 * upstream hiccups must never surface as console noise — the next poll
 * simply retries.
 */
export async function fetchMetarVisibility(): Promise<VisibilityReading[]> {
  try {
    const res = await fetch(METAR_ENDPOINT, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.debug(`[METAR] endpoint ${res.status}, skipping until next poll`);
      return [];
    }
    const data: unknown = await res.json();
    return metarToVisibilityReadings(data);
  } catch (err) {
    console.debug('[METAR] fetch failed:', err);
    return [];
  }
}
