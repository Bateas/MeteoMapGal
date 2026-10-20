/**
 * Every station's precipitation of the last 75 min, from our own API (/api/v1/readings/precip-recent).
 *
 * The «Lluvia ahora» layer needs it on a cold start: a gauge counts as wet from how much its reading
 * grew over 30 min, and a page that just opened has no history yet (20-oct: 1 wet gauge on a fresh
 * page, ~20 on one open for an hour, same minute). A missing endpoint or a failure gives an empty
 * map: the layer then works as before, from the history the page collects itself.
 */
import type { NormalizedReading } from '../types/station';

const URL_PATH = '/api/v1/readings/precip-recent';
const TIMEOUT_MS = 8_000;

interface Payload { windowMin?: number; stations?: Record<string, unknown> }

/** The payload as precipitation-only readings per station (pure, tested). Anything malformed is skipped. */
export function parseRecentPrecip(data: unknown): Map<string, NormalizedReading[]> {
  const out = new Map<string, NormalizedReading[]>();
  const stations = (data as Payload | null)?.stations;
  if (!stations || typeof stations !== 'object') return out;
  for (const [id, list] of Object.entries(stations)) {
    if (!Array.isArray(list)) continue;
    const rows: NormalizedReading[] = [];
    for (const pair of list) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const [t, mm] = pair;
      if (typeof t !== 'number' || typeof mm !== 'number' || !Number.isFinite(t) || !Number.isFinite(mm) || mm < 0) continue;
      rows.push({
        stationId: id, timestamp: new Date(t), precipitation: mm,
        windSpeed: null, windGust: null, windDirection: null, temperature: null, humidity: null,
        solarRadiation: null, pressure: null, dewPoint: null,
      });
    }
    if (rows.length) out.set(id, rows);
  }
  return out;
}

/** The server remembers its answer for a minute: asking more often only repeats it. The layer asks
 *  on mount, on every radar look and when a gauge turns wet, which can be 3-4 times in a second. */
const REUSE_MS = 60_000;
let last: { at: number; answer: Promise<Map<string, NormalizedReading[]>> } | null = null;

export function fetchRecentPrecip(): Promise<Map<string, NormalizedReading[]>> {
  if (last && Date.now() - last.at < REUSE_MS) return last.answer;
  const answer = (async () => {
    try {
      const res = await fetch(URL_PATH, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return new Map<string, NormalizedReading[]>();
      return parseRecentPrecip(await res.json());
    } catch {
      return new Map<string, NormalizedReading[]>();
    }
  })();
  last = { at: Date.now(), answer };
  return answer;
}

export function __clearRecentPrecipForTests(): void { last = null; }
