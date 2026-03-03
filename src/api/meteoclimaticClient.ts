import type { MeteoclimaticRawStation } from '../types/meteoclimatic';
import { METEOCLIMATIC_REGIONS } from '../types/meteoclimatic';
import { METEOCLIMATIC } from '../config/apiEndpoints';

/**
 * Parse a Meteoclimatic XML feed into structured station data.
 * Uses DOMParser to handle the XML response.
 */
/** Decode HTML entities (e.g. &ntilde; → ñ) that some XML feeds leave unresolved. */
function decodeEntities(text: string): string {
  const ta = document.createElement('textarea');
  ta.innerHTML = text;
  return ta.value;
}

function parseXmlFeed(xmlText: string): MeteoclimaticRawStation[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const stations: MeteoclimaticRawStation[] = [];

  const stationEls = doc.querySelectorAll('station');
  for (const el of stationEls) {
    const id = el.querySelector('id')?.textContent ?? '';
    const location = decodeEntities(el.querySelector('location')?.textContent ?? '');
    const pubDate = el.querySelector('pubDate')?.textContent ?? '';
    const qos = parseInt(el.querySelector('QOS')?.textContent ?? '0', 10);

    const data = el.querySelector('stationdata');
    if (!data) continue;

    const getVal = (parent: string, child: string): number | null => {
      const text = data.querySelector(`${parent} > ${child}`)?.textContent;
      if (!text) return null;
      const n = parseFloat(text);
      return isNaN(n) ? null : n;
    };

    stations.push({
      id,
      location,
      pubDate,
      qos,
      temperature: getVal('temperature', 'now'),
      humidity: getVal('humidity', 'now'),
      pressure: getVal('barometre', 'now'),
      windSpeed: getVal('wind', 'now'),
      windAzimuth: getVal('wind', 'azimuth'),
      windGust: getVal('wind', 'max'),
      rain: getVal('rain', 'total'),
    });
  }

  return stations;
}

/** Cache for the XML feed, keyed by sorted region list (short TTL) */
const feedCacheMap = new Map<string, { data: MeteoclimaticRawStation[]; ts: number }>();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Fetch Meteoclimatic stations from the given regions.
 * Fetches feeds in parallel and deduplicates by station ID.
 * Cache is keyed by region set so sector switches don't serve stale data.
 */
export async function fetchMeteoclimaticFeed(
  regions: string[] = [...METEOCLIMATIC_REGIONS],
): Promise<MeteoclimaticRawStation[]> {
  const cacheKey = [...regions].sort().join(',');
  const cached = feedCacheMap.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const results = await Promise.allSettled(
    regions.map(async (region) => {
      const url = METEOCLIMATIC.regionFeed(region);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Meteoclimatic ${region} feed error: ${resp.status}`);
      const xmlText = await resp.text();
      return parseXmlFeed(xmlText);
    })
  );

  // Merge all feeds, deduplicate by station ID
  const seen = new Set<string>();
  const data: MeteoclimaticRawStation[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const station of result.value) {
        if (!seen.has(station.id)) {
          seen.add(station.id);
          data.push(station);
        }
      }
    }
  }

  feedCacheMap.set(cacheKey, { data, ts: Date.now() });
  return data;
}
