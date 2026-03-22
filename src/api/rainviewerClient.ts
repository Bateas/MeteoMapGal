/**
 * RainViewer API client — animated radar tiles (past 2h).
 *
 * Free tier: 12-13 past frames (10min intervals), no nowcast.
 * Tiles: standard XYZ, max zoom 7 (upscaled beyond).
 * No API key needed. CORS-friendly.
 *
 * Attribution required: "RainViewer" with link to https://www.rainviewer.com
 *
 * @see https://www.rainviewer.com/api/weather-maps-api.html
 */

export interface RainViewerFrame {
  /** Unix timestamp (seconds) */
  time: number;
  /** Tile path, e.g. "/v2/radar/1774185000" */
  path: string;
}

export interface RainViewerData {
  /** Base URL for tiles, e.g. "https://tilecache.rainviewer.com" */
  host: string;
  /** Past radar frames (last ~2h, 10min intervals) */
  past: RainViewerFrame[];
  /** Nowcast frames (empty on free tier) */
  nowcast: RainViewerFrame[];
}

const API_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const CACHE_TTL = 5 * 60 * 1000; // 5 min

let cached: RainViewerData | null = null;
let cachedAt = 0;

/**
 * Fetch available radar frames from RainViewer.
 * Returns host + past frames array. Cached for 5 min.
 */
export async function fetchRainViewerFrames(): Promise<RainViewerData | null> {
  if (cached && Date.now() - cachedAt < CACHE_TTL) return cached;

  try {
    const res = await fetch(API_URL, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      console.warn(`[RainViewer] API error: ${res.status}`);
      return cached;
    }

    const data = await res.json();
    const result: RainViewerData = {
      host: data.host || 'https://tilecache.rainviewer.com',
      past: data.radar?.past || [],
      nowcast: data.radar?.nowcast || [],
    };

    cached = result;
    cachedAt = Date.now();
    console.debug(`[RainViewer] ${result.past.length} past + ${result.nowcast.length} nowcast frames`);
    return result;
  } catch (err) {
    console.warn('[RainViewer] Fetch error:', err);
    return cached;
  }
}

/**
 * Build tile URL for a given frame.
 * Color scheme 2 (Universal Blue), smooth=1, snow=1.
 */
export function buildTileUrl(host: string, framePath: string): string {
  return `${host}${framePath}/256/{z}/{x}/{y}/2/1_1.png`;
}
