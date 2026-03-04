/**
 * AEMET Radar client — fetches regional radar PNG from OpenData API.
 *
 * Uses the same two-step pattern as other AEMET endpoints:
 * 1. GET /api/red/radar/regional/ga → { datos: "URL_TO_PNG" }
 * 2. Proxy the datos URL → raw PNG image
 *
 * Radar "ga" = Cuntis (Galicia), range ~240km, updates every 10 min.
 * The PNG is a geo-referenced composite already projected.
 */

import type { AemetApiResponse } from '../types/aemet';
import { AEMET } from '../config/apiEndpoints';

/** Cached radar image URL and its fetch timestamp */
let cachedRadarUrl: string | null = null;
let cachedAt = 0;

/** Cache TTL: 5 min (radar updates every 10 min) */
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Fetch the latest regional radar image URL for Galicia.
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
    const endpoint = AEMET.radarRegional('ga');
    const metaRes = await fetch(endpoint);

    if (!metaRes.ok) {
      console.warn(`[AEMET Radar] Step 1 failed: ${metaRes.status}`);
      return cachedRadarUrl; // Return stale cache if available
    }

    const meta: AemetApiResponse = await metaRes.json();
    if (meta.estado !== 200 || !meta.datos) {
      console.warn(`[AEMET Radar] Error: ${meta.descripcion}`);
      return cachedRadarUrl;
    }

    // Step 2: build the proxied URL (don't fetch the PNG — MapLibre will load it)
    const imageUrl = AEMET.proxyDataUrl(meta.datos);

    cachedRadarUrl = imageUrl;
    cachedAt = Date.now();
    console.debug('[AEMET Radar] Image URL updated');

    return imageUrl;
  } catch (err) {
    console.warn('[AEMET Radar] Fetch error:', err);
    return cachedRadarUrl; // Graceful fallback to stale cache
  }
}
