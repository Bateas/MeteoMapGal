/**
 * NAO/AO teleconnection index client — fetches daily indices from NOAA CPC.
 * Data: ftp.cpc.ncep.noaa.gov/cwlinks/
 * Format: "YYYY  M  D  value" per line (space-separated).
 * Cached 6h (indices update daily, no rush).
 */

const NAO_URL = '/noaa-api/cwlinks/norm.daily.nao.index.b500101.current.ascii';
const AO_URL = '/noaa-api/cwlinks/norm.daily.ao.index.b500101.current.ascii';

const CACHE_TTL = 6 * 60 * 60_000; // 6 hours

export interface TeleconnectionIndex {
  name: 'NAO' | 'AO';
  date: string;       // YYYY-MM-DD
  value: number;
  trend: number;      // difference from 7 days ago
  avg30d: number;     // 30-day running average
}

interface CacheEntry {
  data: TeleconnectionIndex;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Parse the last N days from a NOAA index file */
function parseLast(text: string, name: 'NAO' | 'AO', days: number): { values: { date: string; val: number }[] } {
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
  return { values };
}

async function fetchIndex(url: string, name: 'NAO' | 'AO'): Promise<TeleconnectionIndex> {
  const cached = cache.get(name);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.data;

  const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) throw new Error(`NOAA ${name}: ${resp.status}`);
  const text = await resp.text();

  const { values } = parseLast(text, name, 35); // need 30+ for avg
  if (values.length < 2) throw new Error(`NOAA ${name}: insufficient data`);

  const latest = values[values.length - 1];
  const weekAgo = values.length >= 8 ? values[values.length - 8] : values[0];
  const last30 = values.slice(-30);
  const avg30d = last30.reduce((s, v) => s + v.val, 0) / last30.length;

  const result: TeleconnectionIndex = {
    name,
    date: latest.date,
    value: latest.val,
    trend: latest.val - weekAgo.val,
    avg30d: Math.round(avg30d * 100) / 100,
  };

  cache.set(name, { data: result, fetchedAt: Date.now() });
  return result;
}

export async function fetchNAO(): Promise<TeleconnectionIndex> {
  return fetchIndex(NAO_URL, 'NAO');
}

export async function fetchAO(): Promise<TeleconnectionIndex> {
  return fetchIndex(AO_URL, 'AO');
}

export async function fetchTeleconnections(): Promise<TeleconnectionIndex[]> {
  const [nao, ao] = await Promise.allSettled([fetchNAO(), fetchAO()]);
  const results: TeleconnectionIndex[] = [];
  if (nao.status === 'fulfilled') results.push(nao.value);
  if (ao.status === 'fulfilled') results.push(ao.value);
  return results;
}
