/**
 * IPMA's surface GeoJSON, asked once per slot and shared by the poll and discovery.
 *
 * The file holds every station in Portugal (we keep four) and IPMA updates it hourly. The poll
 * asked for it every 5 min and discovery again every hour: ~310 downloads a day for data that
 * changes 24 times. Now the poll asks at most once per 30-min slot of the clock
 * (sourceCadence.ts) and reuses the last good file in between; discovery reuses the poll's file
 * when it is recent and only asks when there is none. Two callers at once share one request.
 */
import type { IpmaFeature } from '../src/services/normalizer.js';
import { IPMA_SLOT_MS, IPMA_SLOT_OFFSET_MS, slotOf, slotPollDue } from './sourceCadence.js';

export const IPMA_GEOJSON_URL = 'https://api.ipma.pt/open-data/observation/meteorology/stations/obs-surface.geojson';

/** Discovery runs hourly; a file younger than this already lists the same stations. */
export const IPMA_DISCOVERY_REUSE_MS = 3 * 3600_000;

const TIMEOUT_MS = 15_000;

/** A feature as the GeoJSON carries it (the shape the shared normalizers read). */
export type IpmaRawFeature = IpmaFeature;

export interface IpmaFeedAnswer {
  features: IpmaRawFeature[];
  /** True when the features are the last good file, handed back without asking IPMA. */
  reused: boolean;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** One feed per process; the factory exists so tests can give it their own fetch and clock. */
export function createIpmaFeed(fetchFn: FetchFn = (url, init) => fetch(url, init), clock: () => number = () => Date.now()) {
  let lastFeatures: IpmaRawFeature[] | null = null;
  let lastGoodAt: number | null = null;
  let lastGoodSlot: number | null = null;
  let inFlight: Promise<IpmaRawFeature[]> | null = null;

  async function download(): Promise<IpmaRawFeature[]> {
    const res = await fetchFn(IPMA_GEOJSON_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { features?: unknown };
    if (!Array.isArray(data?.features)) throw new Error('GeoJSON without features');
    const features = data.features as IpmaRawFeature[];
    if (features.length > 0) {
      const now = clock();
      lastFeatures = features;
      lastGoodAt = now;
      lastGoodSlot = slotOf(now, IPMA_SLOT_MS, IPMA_SLOT_OFFSET_MS);
    }
    return features;
  }

  function ask(): Promise<IpmaRawFeature[]> {
    if (!inFlight) inFlight = download().finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    /** For the 5-min poll: IPMA at most once per slot, the last good file otherwise. Throws on failure. */
    async forPoll(): Promise<IpmaFeedAnswer> {
      if (lastFeatures && !slotPollDue(lastGoodSlot, clock(), IPMA_SLOT_MS, IPMA_SLOT_OFFSET_MS)) {
        return { features: lastFeatures, reused: true };
      }
      return { features: await ask(), reused: false };
    },
    /** For hourly discovery: the poll's file if recent, IPMA only when there is none. Throws on failure. */
    async forDiscovery(): Promise<IpmaFeedAnswer> {
      if (lastFeatures && lastGoodAt != null && clock() - lastGoodAt < IPMA_DISCOVERY_REUSE_MS) {
        return { features: lastFeatures, reused: true };
      }
      return { features: await ask(), reused: false };
    },
  };
}

export const ipmaFeed = createIpmaFeed();
