/**
 * AEMET Radar client — fetches national radar composite PNG from OpenData API.
 *
 * Uses the same two-step pattern as other AEMET endpoints:
 * 1. GET /api/red/radar/nacional → { datos: "URL_TO_PNG" }
 * 2. Proxy the datos URL → raw PNG image
 *
 * National composite covers all Spain including Galicia (Cerceda/A Coruña radar).
 * Note: The regional endpoint /api/red/radar/regional/{code} does NOT have a code
 * for Galicia — 'ga' was never valid (returns 404). The Cerceda radar was added to
 * the AEMET network after the regional API was established.
 *
 * Updates every 10 min. We cache for 5 min.
 */

import type { AemetApiResponse } from '../types/aemet';
import { AEMET } from '../config/apiEndpoints';

/** Cached radar image URL and its fetch timestamp */
let cachedRadarUrl: string | null = null;
let cachedAt = 0;

/** Cache TTL: 5 min (radar updates every 10 min) */
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Fetch the latest national radar composite image URL.
 * Returns a proxied URL to the PNG that can be used as an image source.
 * Returns null on error (non-critical — radar is supplementary).
 */
export async function fetchRadarImageUrl(): Promise<string | null> {
  // Return cached URL if fresh
  if (cachedRadarUrl && Date.now() - cachedAt < CACHE_TTL) {
    return cachedRadarUrl;
  }

  try {
    // Step 1: get the metadata with PNG URL
    const endpoint = AEMET.radarNacional();
    const metaRes = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) });

    if (!metaRes.ok) {
      console.warn(`[AEMET Radar] Step 1 failed: ${metaRes.status}`);
      return cachedRadarUrl; // Return stale cache if available
    }

    const meta: AemetApiResponse = await metaRes.json();
    if (meta.estado !== 200 || !meta.datos) {
      console.warn(`[AEMET Radar] Error: ${meta.descripcion}`);
      return cachedRadarUrl;
    }

    // Step 2: build the proxied URL
    const imageUrl = AEMET.proxyDataUrl(meta.datos);

    // Step 3: validate the image is actually loadable (prevents MapLibre silent failures)
    const imgRes = await fetch(imageUrl, { method: 'HEAD', signal: AbortSignal.timeout(8_000) });
    if (!imgRes.ok) {
      console.warn(`[AEMET Radar] Image validation failed: ${imgRes.status} for ${imageUrl}`);
      return cachedRadarUrl;
    }

    cachedRadarUrl = imageUrl;
    cachedAt = Date.now();
    console.debug('[AEMET Radar] National composite URL updated + validated');

    return imageUrl;
  } catch (err) {
    console.warn('[AEMET Radar] Fetch error:', err);
    return cachedRadarUrl; // Graceful fallback to stale cache
  }
}
