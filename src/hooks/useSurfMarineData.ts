/**
 * Auto-fetch Open-Meteo Marine current wave data for all surf spots.
 * Populates spotStore.surfWaveCache so SpotMarker shows correct wave verdict
 * without waiting for the user to open the popup.
 *
 * Runs once on mount + every 15 min. Only for Rías sector (surf spots are Rías-only).
 */
import { useEffect, useRef } from 'react';
import { useSectorStore } from '../store/sectorStore';
import { useSpotStore } from '../store/spotStore';
import { getSpotsForSector } from '../config/spots';
import { fetchMarineForecast } from '../api/marineClient';

const INTERVAL = 15 * 60_000; // 15 min — marine forecast changes slowly

export function useSurfMarineData() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const setSurfWave = useSpotStore((s) => s.setSurfWave);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const spots = getSpotsForSector(sectorId).filter((s) => s.category === 'surf');
    if (spots.length === 0) return;

    async function fetchAll() {
      for (const spot of spots) {
        try {
          const hours = await fetchMarineForecast(spot.center[1], spot.center[0]);
          const now = hours[0];
          if (now) {
            const wh = now.swellHeight ?? now.waveHeight ?? 0;
            setSurfWave(spot.id, {
              waveHeight: wh,
              swellHeight: now.swellHeight,
              period: now.swellPeriod ?? now.wavePeriod ?? 0,
            });
          }
        } catch { /* ignore — cached data will be used */ }
      }
    }

    // Fetch immediately + schedule repeat
    fetchAll();
    timerRef.current = setInterval(fetchAll, INTERVAL);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sectorId, setSurfWave]);
}
