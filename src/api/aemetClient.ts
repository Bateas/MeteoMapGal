import type { AemetApiResponse, AemetRawObservation, AemetRawStation } from '../types/aemet';
import { AEMET } from '../config/apiEndpoints';

/**
 * AEMET uses a two-step fetch pattern:
 * 1. Request endpoint → returns { datos: "URL_TO_DATA" }
 * 2. Fetch that URL → returns actual data array
 *
 * Includes retry with exponential backoff for 429 rate-limit errors.
 */

/** Track rate-limit state to fail fast on subsequent calls */
let rateLimitUntil = 0;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function aemetTwoStepFetch<T>(endpoint: string): Promise<T> {
  // Circuit breaker: skip if we're still in rate-limit cooldown
  if (Date.now() < rateLimitUntil) {
    throw new Error('AEMET rate-limited — esperando cooldown');
  }

  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 2000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Step 1: Get metadata with data URL
    const metaRes = await fetch(endpoint);

    if (metaRes.status === 429) {
      // Rate limited: set cooldown and retry with backoff
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) * (0.8 + Math.random() * 0.4);
      if (attempt < MAX_RETRIES) {
        console.warn(`[AEMET] 429 rate-limited, retry ${attempt + 1}/${MAX_RETRIES} en ${(delay / 1000).toFixed(1)}s`);
        await sleep(delay);
        continue;
      }
      // All retries exhausted: set circuit breaker for 5 minutes
      rateLimitUntil = Date.now() + 5 * 60 * 1000;
      console.warn('[AEMET] Rate-limit persistente, cooldown 5 min');
      throw new Error('AEMET 429: rate-limit tras 3 reintentos');
    }

    if (!metaRes.ok) {
      throw new Error(`AEMET step 1 failed: ${metaRes.status} ${metaRes.statusText}`);
    }

    const meta: AemetApiResponse = await metaRes.json();
    if (meta.estado !== 200 || !meta.datos) {
      throw new Error(`AEMET error: ${meta.descripcion} (estado: ${meta.estado})`);
    }

    // Step 2: Fetch actual data from the returned URL
    // Route through our proxy to avoid CORS
    const dataUrl = AEMET.proxyDataUrl(meta.datos);
    const dataRes = await fetch(dataUrl);
    if (!dataRes.ok) {
      throw new Error(`AEMET step 2 failed: ${dataRes.status} ${dataRes.statusText}`);
    }

    // Success: reset rate limit state
    rateLimitUntil = 0;
    return dataRes.json();
  }

  throw new Error('AEMET: reintentos agotados');
}

/** Fetch all conventional observations from all AEMET stations */
export async function fetchAllObservations(): Promise<AemetRawObservation[]> {
  return aemetTwoStepFetch<AemetRawObservation[]>(AEMET.allObservations());
}

/** Fetch AEMET station inventory */
export async function fetchStationInventory(): Promise<AemetRawStation[]> {
  // Check localStorage cache (inventory rarely changes)
  const CACHE_KEY = 'aemet_station_inventory';
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_TTL) {
      return data;
    }
  }

  const stations = await aemetTwoStepFetch<AemetRawStation[]>(AEMET.stationInventory());

  localStorage.setItem(CACHE_KEY, JSON.stringify({
    data: stations,
    timestamp: Date.now(),
  }));

  return stations;
}
