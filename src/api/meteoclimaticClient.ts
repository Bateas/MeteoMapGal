import type { MeteoclimaticRawStation } from '../types/meteoclimatic';
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

/** Cache for the XML feed (short TTL since data updates frequently) */
let feedCache: { data: MeteoclimaticRawStation[]; ts: number } | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Fetch all Meteoclimatic stations for the Ourense region (ESGAL32).
 * Returns parsed station data from the XML feed.
 */
export async function fetchMeteoclimaticFeed(): Promise<MeteoclimaticRawStation[]> {
  if (feedCache && Date.now() - feedCache.ts < CACHE_TTL_MS) {
    return feedCache.data;
  }

  const url = METEOCLIMATIC.regionFeed('ESGAL32');
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`Meteoclimatic feed error: ${resp.status}`);
  }

  const xmlText = await resp.text();
  const data = parseXmlFeed(xmlText);

  feedCache = { data, ts: Date.now() };
  console.log(`[Meteoclimatic] Parsed ${data.length} stations from feed`);

  return data;
}
