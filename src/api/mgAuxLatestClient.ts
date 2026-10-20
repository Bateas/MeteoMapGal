/**
 * Last 2 m wind of ONE MeteoGalicia station, for that station's popup only.
 *
 * The 2 m wind is archived in shadow (see src/api/mgAux2m.ts): among the vines it reads far less than
 * the wind on the water and it is not validated. It is SHOWN as what it is in the popup of its own
 * station and must never feed the verdicts, the consensus, the map arrows, the wind field, the ticker
 * or the alerts. Nothing here writes to a store; a guard test (src/test/mgAuxShadowGuard.test.ts)
 * fails if any other module starts reading it.
 */
import { msToKnots, degreesToCardinal } from '../services/windUtils';

export interface MgAuxLatest {
  stationId: string;
  time: Date;
  wind2m: number | null;  // m/s
  gust2m: number | null;  // m/s
  dir2m: number | null;   // degrees, from
}

const ENDPOINT = '/api/v1/stations/mg-aux-latest';
const TTL_MS = 2 * 60_000;

/** Module-level promise cache: a popup that closes and reopens waits for the same answer. */
const cache = new Map<string, { at: number; promise: Promise<MgAuxLatest | null> }>();

/** Testing only. */
export function __clearMgAuxLatestCacheForTests(): void {
  cache.clear();
}

const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The API answer to a reading, or null for anything unusable (pure). */
export function parseMgAuxLatest(body: unknown): MgAuxLatest | null {
  const reading = (body as { reading?: unknown } | null)?.reading as Record<string, unknown> | null | undefined;
  if (!reading || typeof reading !== 'object') return null;
  const time = new Date(String(reading.time));
  if (Number.isNaN(time.getTime()) || typeof reading.stationId !== 'string') return null;
  const out: MgAuxLatest = {
    stationId: reading.stationId,
    time,
    wind2m: finiteOrNull(reading.wind2m),
    gust2m: finiteOrNull(reading.gust2m),
    dir2m: finiteOrNull(reading.dir2m),
  };
  return out.wind2m == null && out.gust2m == null ? null : out;
}

export function fetchMgAuxLatest(stationId: string): Promise<MgAuxLatest | null> {
  const hit = cache.get(stationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = fetch(`${ENDPOINT}?station_id=${encodeURIComponent(stationId)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => parseMgAuxLatest(body))
    .catch(() => {
      cache.delete(stationId);
      return null;
    });
  cache.set(stationId, { at: Date.now(), promise });
  return promise;
}

/** «racha X kt del Y (media Z kt)», with only the parts that exist; null when there is no speed. */
export function formatAux2mWind(r: MgAuxLatest): string | null {
  const kt = (ms: number) => `${Math.round(msToKnots(ms))} kt`;
  const dir = r.dir2m != null ? ` del ${degreesToCardinal(r.dir2m)}` : '';
  if (r.gust2m != null) {
    const mean = r.wind2m != null ? ` (media ${kt(r.wind2m)})` : '';
    return `racha ${kt(r.gust2m)}${dir}${mean}`;
  }
  if (r.wind2m != null) return `media ${kt(r.wind2m)}${dir}`;
  return null;
}
