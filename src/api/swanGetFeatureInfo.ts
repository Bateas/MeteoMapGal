/**
 * SWAN GetFeatureInfo per-spot Hs (wave height) reader.
 *
 * T5-3 (S136+3+3). The SWAN overlay renders the whole Galicia coast as a
 * raster tile, but for SpotPopup surf verdicts we need the actual wave
 * height (Hs) at the specific spot lat/lon. WMS GetFeatureInfo lets us
 * query a single pixel value without downloading and parsing tiles.
 *
 * THREDDS endpoint (CESGA academic) is frequently slow/down. The caller
 * MUST handle null gracefully — never block a popup waiting for this.
 *
 * Output unit: meters (Hs / significant wave height).
 */

const SWAN_GFI_BASE = '/swan-api/thredds/wms/SWAN/agg/SWAN_agg_best.ncd';

interface SwanHsResult {
  /** Significant wave height in meters, or null on failure / no value */
  hs: number | null;
  /** Forecast time the value applies to (ISO) */
  time: string;
  /** Source label for debug / UI */
  source: 'swan-wms';
}

/**
 * Build TIME parameter aligned to the next forecast hour (SWAN is hourly).
 */
function timeForOffset(offsetHours: number): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + offsetHours);
  return d.toISOString().replace(/\.\d+Z$/, '.000Z');
}

/**
 * Parse the THREDDS WMS GetFeatureInfo XML response.
 *
 * Sample response (truncated for clarity):
 * ```xml
 * <FeatureInfoResponse>
 *   <FeatureInfo>
 *     <time>2026-05-27T16:00:00Z</time>
 *     <value>1.84</value>
 *   </FeatureInfo>
 * </FeatureInfoResponse>
 * ```
 *
 * Empty / 'none' / out-of-domain returns `<value>none</value>` or omits
 * the tag — both map to null.
 */
export function parseSwanGfiXml(xml: string): { hs: number | null; time: string | null } {
  // Use a simple regex parser — the XML is tiny and predictable. Avoids
  // pulling in DOMParser (browser-only) or jsdom dependency.
  const valueMatch = xml.match(/<value>\s*([^<\s]+)\s*<\/value>/i);
  const timeMatch = xml.match(/<time>\s*([^<\s]+)\s*<\/time>/i);

  let hs: number | null = null;
  if (valueMatch) {
    const raw = valueMatch[1].trim();
    if (raw && raw.toLowerCase() !== 'none' && raw.toLowerCase() !== 'nan') {
      const parsed = parseFloat(raw);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed < 30) {
        // 30m sanity cap (largest wave ever measured ~26m). >30 = parse error.
        hs = parsed;
      }
    }
  }
  return { hs, time: timeMatch?.[1] ?? null };
}

/**
 * Build the GetFeatureInfo URL for a single point.
 *
 * Trick: WMS GetFeatureInfo needs a bbox + width/height + X/Y pixel
 * coords. We use a 2×2 grid and query pixel (0,0) — the query point IS
 * the top-left of a tiny 2×2 bbox centered on the lat/lon of interest.
 */
export function buildSwanGfiUrl(opts: {
  lat: number;
  lon: number;
  /** Hour offset from now (default 0 = current hour) */
  hourOffset?: number;
}): string {
  const lat = opts.lat;
  const lon = opts.lon;
  const dLat = 0.01; // ~1 km — sub-resolution of SWAN 250m grid
  const dLon = 0.01;
  const bbox = `${(lon - dLon).toFixed(4)},${(lat - dLat).toFixed(4)},${(lon + dLon).toFixed(4)},${(lat + dLat).toFixed(4)}`;
  const time = timeForOffset(opts.hourOffset ?? 0);
  // X=0, Y=0 = top-left pixel of a 2x2 grid → spot lat/lon.
  // INFO_FORMAT=text/xml is the THREDDS default and well-supported.
  return `${SWAN_GFI_BASE}`
    + `?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo`
    + `&LAYERS=hs&QUERY_LAYERS=hs`
    + `&SRS=EPSG:4326&BBOX=${bbox}`
    + `&WIDTH=2&HEIGHT=2&X=0&Y=0`
    + `&INFO_FORMAT=text/xml`
    + `&TIME=${encodeURIComponent(time)}`;
}

/**
 * Fetch significant wave height (Hs) at a single point from SWAN.
 *
 * Returns `{ hs: null }` on:
 *   - HTTP error (CESGA frequently down)
 *   - Timeout (>5s)
 *   - Parse failure
 *   - Point outside SWAN domain (open Atlantic / inland)
 *
 * Callers should display this as a soft enhancement, never as primary
 * data — SpotPopup uses `score.waves` as the primary source and overlays
 * this when present.
 */
export async function fetchSwanHsAt(
  lat: number,
  lon: number,
  hourOffset = 0,
): Promise<SwanHsResult> {
  const url = buildSwanGfiUrl({ lat, lon, hourOffset });
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) {
      return { hs: null, time: timeForOffset(hourOffset), source: 'swan-wms' };
    }
    const xml = await res.text();
    const { hs, time } = parseSwanGfiXml(xml);
    return {
      hs,
      time: time ?? timeForOffset(hourOffset),
      source: 'swan-wms',
    };
  } catch {
    // Silent failure — caller treats null as "no data, fall back to buoy/forecast"
    return { hs: null, time: timeForOffset(hourOffset), source: 'swan-wms' };
  }
}
