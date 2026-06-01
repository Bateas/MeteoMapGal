/**
 * Scores user-created "chincheta" spots with the SAME config-driven engine as
 * official spots, but in BASIC mode: no thermal context, no teleconnections,
 * no reading history. That keeps the estimate honest ("SIN CALIBRAR") and the
 * results fully isolated from `spotStore` / official alerts (moat O3).
 *
 * Only runs when the active sector has user spots — zero cost otherwise.
 */
import { useEffect, useRef } from 'react';
import { useWeatherStore } from '../store/weatherStore';
import { useBuoyStore } from '../store/buoyStore';
import { useSectorStore } from '../store/sectorStore';
import { useUserSpotStore } from '../store/userSpotStore';
import { scoreAllSpots } from '../services/spotScoringEngine';
import { userSpotToSailingSpot } from '../config/userSpots';

const RESCORE_INTERVAL_MS = 15_000;

export function useUserSpotScoring() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const stations = useWeatherStore((s) => s.stations);
  const readingsEpoch = useWeatherStore((s) => s.readingsEpoch);
  const buoys = useBuoyStore((s) => s.buoys);
  const userSpots = useUserSpotStore((s) => s.userSpots);
  const setUserScores = useUserSpotStore((s) => s.setUserScores);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastScoredRef = useRef(0);

  useEffect(() => {
    const mine = userSpots.filter((u) => u.sectorId === sectorId);

    // Clear stale scores when the user has no pins in this sector.
    if (mine.length === 0) {
      if (useUserSpotStore.getState().scores.size > 0) setUserScores(new Map());
      return;
    }
    if (stations.length === 0 && buoys.length === 0) return;

    const now = Date.now();
    if (now - lastScoredRef.current < RESCORE_INTERVAL_MS) return;

    timerRef.current = setTimeout(() => {
      const { currentReadings } = useWeatherStore.getState();
      const sailingSpots = mine.map(userSpotToSailingSpot);
      // Basic scoring: no thermalData / teleconnections / readingHistory.
      const scores = scoreAllSpots(sailingSpots, stations, currentReadings, buoys);
      setUserScores(scores);
      lastScoredRef.current = Date.now();
    }, 60);

    return () => clearTimeout(timerRef.current);
  }, [sectorId, stations, readingsEpoch, buoys, userSpots, setUserScores]);
}
