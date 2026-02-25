import type { AemetApiResponse, AemetRawObservation, AemetRawStation } from '../types/aemet';
import { AEMET } from '../config/apiEndpoints';

/**
 * AEMET uses a two-step fetch pattern:
 * 1. Request endpoint → returns { datos: "URL_TO_DATA" }
 * 2. Fetch that URL → returns actual data array
 */
async function aemetTwoStepFetch<T>(endpoint: string): Promise<T> {
  // Step 1: Get metadata with data URL
  const metaRes = await fetch(endpoint);
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

  return dataRes.json();
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
