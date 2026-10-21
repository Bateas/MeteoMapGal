/**
 * NAO/AO teleconnection indices (NOAA CPC daily files, read by our server: ingestor/teleconnections.ts).
 * Format of the files: "YYYY  M  D  value" per line (space-separated).
 */

/** Our own API: the server reads both NOAA files once every 12 h and hands back four numbers each
 *  (each visitor used to download 2 x ~500 KB to read 35 lines). */
const URL_PATH = '/api/v1/teleconnections';

const CACHE_TTL = 6 * 60 * 60_000; // 6 hours

/** NOAA's «current» file can stop for weeks (on 21-oct-2026 it ended on 30-sep). An index older
 *  than this is not today's circulation and is not used. */
export const MAX_INDEX_AGE_DAYS = 10;

export interface TeleconnectionIndex {
  name: 'NAO' | 'AO';
  date: string;       // YYYY-MM-DD
  value: number;
  trend: number;      // difference from 7 days ago
  avg30d: number;     // 30-day running average
}

/** Parse the last N days from a NOAA index file */
function parseLast(text: string, days: number): { date: string; val: number }[] {
  const lines = text.trim().split('\n');
  const values: { date: string; val: number }[] = [];

  // Parse from the end (most recent data)
  const start = Math.max(0, lines.length - days);
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [y, m, d, v] = parts;
    const val = parseFloat(v);
    if (!Number.isFinite(val)) continue;
    const date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    values.push({ date, val });
  }
  return values;
}

/** A NOAA daily index file -> latest value, 7-day trend and 30-day mean (pure; the server uses it). */
export function summariseIndex(text: string, name: 'NAO' | 'AO'): TeleconnectionIndex | null {
  const values = parseLast(text, 35); // need 30+ for avg
  if (values.length < 2) return null;
  const latest = values[values.length - 1];
  const weekAgo = values.length >= 8 ? values[values.length - 8] : values[0];
  const last30 = values.slice(-30);
  const avg30d = last30.reduce((s, v) => s + v.val, 0) / last30.length;
  return {
    name,
    date: latest.date,
    value: latest.val,
    trend: latest.val - weekAgo.val,
    avg30d: Math.round(avg30d * 100) / 100,
  };
}

/** True when the index is recent enough to describe today's circulation (pure, tested). */
export function isFreshIndex(index: Pick<TeleconnectionIndex, 'date'>, now = Date.now()): boolean {
  const t = Date.parse(`${index.date}T00:00:00Z`);
  return Number.isFinite(t) && now - t <= MAX_INDEX_AGE_DAYS * 86_400_000;
}

let cache: { at: number; data: TeleconnectionIndex[] } | null = null;

/** The fresh indices only: a stale file gives an empty list, so nothing modulates on old data. */
export async function fetchTeleconnections(): Promise<TeleconnectionIndex[]> {
  if (!cache || Date.now() - cache.at >= CACHE_TTL) {
    try {
      const resp = await fetch(URL_PATH, { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) return [];
      const body = (await resp.json()) as { indices?: TeleconnectionIndex[] };
      cache = { at: Date.now(), data: Array.isArray(body.indices) ? body.indices : [] };
    } catch {
      return [];
    }
  }
  return cache.data.filter((i) => isFreshIndex(i));
}

export function __clearTeleconnectionsForTests(): void { cache = null; }
