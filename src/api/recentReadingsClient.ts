/**
 * Every station's readings of the last 3 h, from our own API (/api/v1/readings/recent).
 *
 * Fills the page's in-memory history on load, so sparklines, 3 h charts and trend detectors start
 * from what the stations measured. Until v2.191.0 that history was 24 h of Open-Meteo model values
 * under each station's id (~25 requests per visitor). A failure gives an empty list: the history
 * then fills from the live polls, as on any fresh page.
 */
import type { NormalizedReading } from '../types/station';

const URL_PATH = '/api/v1/readings/recent';
const TIMEOUT_MS = 12_000;

interface Payload { stations?: Record<string, unknown> }

function cell(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The compact payload as readings, only for the stations asked (pure, tested). */
export function parseRecentReadings(data: unknown, wanted?: ReadonlySet<string>): NormalizedReading[] {
  const out: NormalizedReading[] = [];
  const stations = (data as Payload | null)?.stations;
  if (!stations || typeof stations !== 'object') return out;
  for (const [id, list] of Object.entries(stations)) {
    if (wanted && !wanted.has(id)) continue;
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      if (!Array.isArray(row) || row.length < 10) continue;
      const t = cell(row[0]);
      if (t == null) continue;
      const precip = cell(row[9]);
      out.push({
        stationId: id,
        timestamp: new Date(t),
        windSpeed: cell(row[1]),
        windGust: cell(row[2]),
        windDirection: cell(row[3]),
        temperature: cell(row[4]),
        humidity: cell(row[5]),
        pressure: cell(row[6]),
        dewPoint: cell(row[7]),
        solarRadiation: cell(row[8]),
        precipitation: precip != null && precip >= 0 ? precip : null,
      });
    }
  }
  return out;
}

export async function fetchRecentReadings(stationIds: Iterable<string>): Promise<NormalizedReading[]> {
  try {
    const res = await fetch(URL_PATH, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];
    return parseRecentReadings(await res.json(), new Set(stationIds));
  } catch {
    return [];
  }
}
