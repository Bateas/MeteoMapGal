/**
 * Marine wave forecast for the surf spots, and THE surf verdict.
 *
 * The only writer of spotStore.surfWaveCache. Marker, spot list, popup and
 * ticker only read the entry this hook builds with `buildSurfEntry`, so they
 * cannot disagree about a beach: one function, one forecast hour, one wind
 * (the spot's consensus wind from the score, the same one the popup shows).
 *
 * The forecast HOURS are kept in the entry — they used to be downloaded and
 * thrown away, which is why the popup ran a second download of its own at a
 * different hour and ended up contradicting the marker.
 *
 * Fallback chain: ingestor API (/api/v1/marine) → MeteoSIX USWAN → Open-Meteo
 * Marine direct. Polls every 15 min, only while the sector has surf spots
 * (Rías today; Embalse has none and asks for nothing). The verdict is
 * recomputed WITHOUT a new download whenever the scores change, so a wind
 * shift reaches every surface on the next scoring cycle.
 *
 * A spot with no wind consensus waits («Calculando…») only while the sector's
 * readings are still arriving; once they are in, the missing wind is real
 * (calm, or its sources are down) and the verdict is decided without it.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSectorStore } from '../store/sectorStore';
import { useSpotStore } from '../store/spotStore';
import { useWeatherStore } from '../store/weatherStore';
import { getSpotsForSector } from '../config/spots';
import { fetchMarineForecast, type MarineForecastHour } from '../api/marineClient';
import { fetchMeteoSixMarine } from '../api/meteoSixClient';
import { buildSurfEntry, isReadingSetPartial, sameSurfEntry, type SurfWaveEntry } from '../services/surfVerdictEngine';
import { useVisibilityPolling } from './useVisibilityPolling';

const INTERVAL = 15 * 60_000; // 15 min

/** Fallback chain: ingestor API → MeteoSIX USWAN (1km nearshore) → Open-Meteo Marine */
async function fetchMarineForSpot(spotId: string, lat: number, lon: number): Promise<MarineForecastHour[]> {
  // 1. Try own API first (cached by ingestor, no rate limits)
  try {
    const res = await fetch(`/api/v1/marine?spot=${spotId}`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const json = await res.json();
      if (json.hourly?.length > 0) {
        return json.hourly.map((h: { time: string; waveHeight: number | null; wavePeriod: number | null; waveDirection: number | null; swellHeight: number | null; swellPeriod: number | null }) => ({
          time: new Date(h.time),
          waveHeight: h.waveHeight,
          wavePeriod: h.wavePeriod,
          waveDirection: h.waveDirection,
          swellHeight: h.swellHeight,
          swellPeriod: h.swellPeriod,
          swellDirection: null,
        }));
      }
    }
  } catch { /* API unavailable — fall through */ }

  // 2. Try MeteoSIX USWAN (nearshore, better resolution for Galician coast)
  try {
    const uswan = await fetchMeteoSixMarine(lat, lon);
    if (uswan.length > 0) return uswan;
  } catch { /* MeteoSIX unavailable or no key — fall through */ }

  // 3. Fallback: Open-Meteo Marine direct
  return fetchMarineForecast(lat, lon);
}

function surfSpotsOf(sectorId: string) {
  return getSpotsForSector(sectorId).filter((s) => s.category === 'surf');
}

/** Whether the sector's readings are still arriving — the same inputs the
 *  scoring engine gets (useSpotScoring passes these two from this store).
 *  A surf spot with no wind consensus waits while this is true and decides
 *  without wind once it is not (calm glassy morning, sources down). */
function readingSetPartialNow(nowMs: number): boolean {
  const { stations, currentReadings } = useWeatherStore.getState();
  return isReadingSetPartial(stations.length, currentReadings.values(), nowMs);
}

/**
 * Re-derive every surf entry of the active sector from its stored hours and
 * the current scores. Writes only when something a surface renders changed
 * (label, summary, height to the cm, forecast hour, pending wind): scores are
 * recomputed every poll and most of those passes change nothing here.
 */
export function recomputeSurfVerdicts(nowMs: number = Date.now()): void {
  const st = useSpotStore.getState();
  const sectorId = useSectorStore.getState().activeSector.id;
  const partial = readingSetPartialNow(nowMs);
  let next: Map<string, SurfWaveEntry> | null = null;
  for (const spot of surfSpotsOf(sectorId)) {
    const prev = st.surfWaveCache.get(spot.id);
    if (!prev) continue; // nothing downloaded yet — the fetch will build it
    const entry = buildSurfEntry(spot, prev.hours, st.scores.get(spot.id), nowMs, prev.fetchedAt, partial);
    if (sameSurfEntry(prev, entry)) continue;
    next ??= new Map(st.surfWaveCache);
    next.set(spot.id, entry);
  }
  if (next) st.setSurfWaves(next);
}

export function useSurfMarineData() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const hasSurf = useMemo(() => surfSpotsOf(sectorId).length > 0, [sectorId]);

  // Sector ref to drop stale fetches when the user switches sectors mid-loop
  // (3 surf spots × ~1-2s = up to 6s exposure window per cycle —
  // race-condition audit).
  const sectorIdRef = useRef(sectorId);
  useEffect(() => { sectorIdRef.current = sectorId; }, [sectorId]);

  const fetchAll = useCallback(async () => {
    const fetchSectorId = sectorId;
    for (const spot of surfSpotsOf(fetchSectorId)) {
      if (sectorIdRef.current !== fetchSectorId) return; // sector switched — drop remaining
      let hours: MarineForecastHour[] = [];
      try {
        hours = await fetchMarineForSpot(spot.id, spot.center[1], spot.center[0]);
      } catch { /* every source failed — keep what we had, below */ }
      if (sectorIdRef.current !== fetchSectorId) return; // sector switched during fetch
      const st = useSpotStore.getState();
      const prev = st.surfWaveCache.get(spot.id);
      // Stale-on-error: an empty answer keeps the previous download. The
      // nearest-hour freshness limit inside buildSurfEntry decides whether
      // those hours still describe "now"; if not, the entry says «sin dato».
      const fresh = hours.length > 0;
      const keptHours = fresh ? hours : (prev?.hours ?? []);
      const nowMs = Date.now();
      const fetchedAt = fresh ? nowMs : (prev?.fetchedAt ?? nowMs);
      const entry = buildSurfEntry(spot, keptHours, st.scores.get(spot.id), nowMs, fetchedAt, readingSetPartialNow(nowMs));
      if (!sameSurfEntry(prev, entry)) st.setSurfWave(spot.id, entry);
    }
  }, [sectorId]);

  // A new score (wind shift, cold load settling) re-derives the verdict from
  // the hours already downloaded. Subscribed to the store rather than through
  // a selector so DeferredHooks does not re-render on every scoring pass; the
  // callback only writes surfWaveCache, which it does not listen to — no loop.
  useEffect(() => {
    if (!hasSurf) return;
    recomputeSurfVerdicts();
    return useSpotStore.subscribe((s, p) => {
      if (s.scores !== p.scores) recomputeSurfVerdicts();
    });
  }, [hasSurf]);

  // Coming back to a sector re-derives its entries AT ONCE, inside
  // switchSector itself, before anything renders. The entries kept from the
  // last visit carry a verdict decided with an old wind, and the scores in
  // the store still belong to the sector just left — so the rebuild marks them
  // pending («Calculando…») instead of letting the markers show a stale
  // verdict as firm until the first scoring pass of the new visit.
  useEffect(() => useSectorStore.subscribe((s, p) => {
    if (s.activeSector.id !== p.activeSector.id) recomputeSurfVerdicts();
  }), []);

  // `enabled` follows the sector: entering Rías flips it on and polls at once
  // (before, a switch from Embalse left every surf marker on «FLAT» until the
  // popup happened to download its own copy). Pauses when the tab is hidden.
  useVisibilityPolling(fetchAll, INTERVAL, hasSurf);
}
