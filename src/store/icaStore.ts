/**
 * MeteoGalicia ICA store — official Galician air-quality readings.
 * Sector-agnostic (regional data, like fires + AEMET visibility).
 *
 * Readings EXPIRE by themselves. Consumers (map overlay, ticker) read
 * `readings` directly and have no notion of age, so without expiry a source
 * outage would pin the last "air quality is bad" verdict on screen forever:
 * the fetch returns an empty array on failure, which never overwrites and
 * never clears. A stale reading is worse than no reading, so the store drops
 * its own data once it ages out and consumers just see an empty array.
 */

import { create } from 'zustand';
import type { IcaReading } from '../api/meteoGaliciaIcaClient';

/**
 * The source publishes hourly, so a reading older than this means at least two
 * publications were missed — it no longer describes the air right now.
 */
export const ICA_MAX_AGE_MS = 2 * 60 * 60_000;

interface IcaState {
  readings: IcaReading[];
  fetchedAt: number | null;
  /** Whether `readings` are still recent enough to describe current conditions. */
  isFresh: () => boolean;
  setReadings: (readings: IcaReading[]) => void;
  clear: () => void;
}

/** Wall-clock expiry, so data drops even if nothing polls again. */
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

export const useIcaStore = create<IcaState>((set, get) => ({
  readings: [],
  fetchedAt: null,

  isFresh: () => {
    const { fetchedAt, readings } = get();
    return readings.length > 0 && fetchedAt !== null && Date.now() - fetchedAt < ICA_MAX_AGE_MS;
  },

  setReadings: (readings) => {
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => get().clear(), ICA_MAX_AGE_MS);
    set({ readings, fetchedAt: Date.now() });
  },

  clear: () => {
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = undefined;
    }
    set({ readings: [], fetchedAt: null });
  },
}));
