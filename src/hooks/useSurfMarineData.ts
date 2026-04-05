/**
 * Auto-fetch marine wave data for all surf spots.
 * Populates spotStore.surfWaveCache so SpotMarker shows correct wave verdict.
 *
 * Fallback chain: ingestor API (/api/v1/marine) → Open-Meteo Marine direct.
 * Runs on mount + every 15 min. Only for Rías sector (surf spots are Rías-only).
 */
import { useEffect, useRef } from 'react';
import { useSectorStore } from '../store/sectorStore';
import { useSpotStore } from '../store/spotStore';
import { getSpotsForSector } from '../config/spots';
import { fetchMarineForecast, type MarineForecastHour } from '../api/marineClient';

const INTERVAL = 15 * 60_000; // 15 min

/** Try ingestor API first, fallback to Open-Meteo Marine direct */
async function fetchMarineForSpot(spotId: string, lat: number, lon: number): Promise<MarineForecastHour[]> {
  // Try own API first (cached by ingestor, no rate limits)
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

  // Fallback: Open-Meteo Marine direct
  return fetchMarineForecast(lat, lon);
}

/** Basic surf verdict from wave height + period (no wind modifier) */
function basicSurfVerdict(wh: number, tp: number): { label: string; color: string } {
  let level: number;
  if (wh < 0.3) level = 0;
  else if (wh < 0.8) level = 1;
  else if (wh < 1.5) level = 2;
  else if (wh < 2.5) level = 3;
  else level = 4;

  const baseLevel = level;
  let bonus = 0;
  if (tp >= 10 && level >= 1) bonus = 1;
  else if (tp > 0 && tp < 5 && level >= 1) bonus = -1;
  level = Math.max(0, Math.min(4, baseLevel + Math.max(-1, Math.min(1, bonus))));
  if (level === 4 && wh < 2.0) level = 3;

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
          const hours = await fetchMarineForSpot(spot.id, spot.center[1], spot.center[0]);
          const now = hours[0];
          if (now) {
            // Open-Meteo Marine overpredicts wave height for semi-protected coasts (Rías)
          // Apply 15% coastal reduction factor (validated against Silleiro buoy comparison)
          const rawWh = now.swellHeight ?? now.waveHeight ?? 0;
          const wh = rawWh * 0.85;
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

    // Pause polling when tab is hidden (save bandwidth)
    const onVisibility = () => {
      if (document.hidden) {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      } else {
        fetchAll();
        timerRef.current = setInterval(fetchAll, INTERVAL);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sectorId, setSurfWave]);
}
