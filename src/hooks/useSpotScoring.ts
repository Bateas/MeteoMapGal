/**
 * Hook that computes spot scores from current weather + buoy data.
 * Re-scores when stations, readings, or buoys change.
 * Active for both sectors (Rías + Embalse).
 */
import { useEffect, useRef } from 'react';
import { useWeatherStore } from '../store/weatherStore';
import { useBuoyStore } from '../store/buoyStore';
import { useSpotStore } from '../store/spotStore';
import { useSectorStore } from '../store/sectorStore';
import { scoreAllSpots } from '../services/spotScoringEngine';
import { getSpotsForSector } from '../config/spots';

/** Minimum interval between re-scores (ms) */
const RESCORE_INTERVAL = 30_000; // 30s

export function useSpotScoring() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const stations = useWeatherStore((s) => s.stations);
  const readings = useWeatherStore((s) => s.currentReadings);
  const buoys = useBuoyStore((s) => s.buoys);
  const setScores = useSpotStore((s) => s.setScores);
  const lastScored = useSpotStore((s) => s.lastScored);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const spots = getSpotsForSector(sectorId);
    if (spots.length === 0) return;
    if (stations.length === 0 && buoys.length === 0) return;

    // Throttle re-scores
    const now = Date.now();
    if (now - lastScored < RESCORE_INTERVAL) return;

    // Defer scoring to avoid blocking render
    timerRef.current = setTimeout(() => {
      const scores = scoreAllSpots(spots, stations, readings, buoys);
      setScores(scores);
    }, 100);

    return () => clearTimeout(timerRef.current);
  }, [sectorId, stations, readings, buoys, setScores, lastScored]);
}
