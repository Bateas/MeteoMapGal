/**
 * Auto-fetch Open-Meteo Marine current wave data for all surf spots.
 * Populates spotStore.surfWaveCache with wave data + basic verdict
 * so SpotMarker shows correct wave verdict immediately.
 *
 * Runs once on mount + every 15 min. Only for Rías sector (surf spots are Rías-only).
 * The popup's computeSurfVerdict() refines this with wind modifiers.
 */
import { useEffect, useRef } from 'react';
import { useSectorStore } from '../store/sectorStore';
import { useSpotStore } from '../store/spotStore';
import { getSpotsForSector } from '../config/spots';
import { fetchMarineForecast } from '../api/marineClient';

const INTERVAL = 15 * 60_000; // 15 min — marine forecast changes slowly

/** Basic surf verdict from wave height + period (no wind modifier — that needs wind data from scoring engine) */
function basicSurfVerdict(wh: number, tp: number): { label: string; color: string } {
  let level: number;
  if (wh < 0.3) level = 0;
  else if (wh < 0.8) level = 1;
  else if (wh < 1.5) level = 2;
  else if (wh < 2.5) level = 3;
  else level = 4;

  // Period modifier (same logic as computeSurfVerdict)
  if (tp >= 10 && level >= 1) level = Math.min(4, level + 1);
  else if (tp > 0 && tp < 5 && level >= 1) level = Math.max(0, level - 1);

  const LEVELS: { label: string; color: string }[] = [
    { label: 'FLAT',    color: '#94a3b8' },
    { label: 'PEQUE',   color: '#22d3ee' },
    { label: 'SURF OK', color: '#3b82f6' },
    { label: 'CLASICO', color: '#22c55e' },
    { label: 'GRANDE',  color: '#f97316' },
  ];
  return LEVELS[Math.max(0, Math.min(4, level))];
}

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
            const tp = now.swellPeriod ?? now.wavePeriod ?? 0;
            const v = basicSurfVerdict(wh, tp);
            setSurfWave(spot.id, {
              waveHeight: wh,
              swellHeight: now.swellHeight,
              period: tp,
              verdictLabel: v.label,
              verdictColor: v.color,
            });
          }
        } catch { /* ignore — cached data will be used */ }
      }
    }

    fetchAll();
    timerRef.current = setInterval(fetchAll, INTERVAL);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [sectorId, setSurfWave]);
}
