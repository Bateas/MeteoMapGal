/**
 * CESGA SWAN wave height at the centre of the spots that decide on the sea (those with
 * `waveBuoys`), for the engine's sea gate (spotWaveLocal.ts). Shared by the map (through our
 * proxy, which caches by hour) and the server (straight to CESGA).
 *
 * One request per spot at most every 30 min; a spot whose request fails keeps its last good
 * value for up to 3 h (SWAN runs once a day, the field moves slowly), then drops out and the
 * engine falls back to the buoy estimate. CESGA is often down: never throws.
 */
import type { SailingSpot } from '../config/spots';
import { fetchSwanHsAt } from './swanGetFeatureInfo';

const REFRESH_MS = 30 * 60_000;
const KEEP_MS = 3 * 60 * 60_000;

const last = new Map<string, { hs: number; at: number }>();
let askedAt = 0;
let inFlight: Promise<void> | null = null;

export function spotsDecidingOnSea(spots: SailingSpot[]): SailingSpot[] {
  return spots.filter((s) => (s.waveBuoys?.length ?? 0) > 0);
}

/** The heights it has now (spot id -> m); refreshes in the background when due. */
export function swanHeightsFor(spots: SailingSpot[], base?: string, nowMs = Date.now()): Map<string, number> {
  const targets = spotsDecidingOnSea(spots);
  if (targets.length > 0 && !inFlight && nowMs - askedAt >= REFRESH_MS) {
    askedAt = nowMs;
    inFlight = (async () => {
      for (const s of targets) {
        const r = await fetchSwanHsAt(s.center[1], s.center[0], 0, base);
        if (r.hs != null) last.set(s.id, { hs: r.hs, at: Date.now() });
      }
    })().finally(() => { inFlight = null; });
  }
  const out = new Map<string, number>();
  for (const s of targets) {
    const v = last.get(s.id);
    if (v && nowMs - v.at <= KEEP_MS) out.set(s.id, v.hs);
  }
  return out;
}

/** Waits for a refresh in progress (the server's cycle wants the fresh value on its first run). */
export async function settledSwanHeights(spots: SailingSpot[], base?: string): Promise<Map<string, number>> {
  swanHeightsFor(spots, base);
  if (inFlight) await inFlight;
  return swanHeightsFor(spots, base);
}

export function __resetSwanSpotHeightsForTests(): void {
  last.clear();
  askedAt = 0;
  inFlight = null;
}
