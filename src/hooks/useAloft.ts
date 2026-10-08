/**
 * The active sector's 850 hPa hours and whether it is coastal, for the breeze forecasts
 * (thermalForecastDetector). The hours are written by useSpotScoring into spotStore; a
 * sounding left over from the other sector is ignored. No data = no veto.
 */
import { useMemo } from 'react';
import { useSectorStore } from '../store/sectorStore';
import { useSpotStore } from '../store/spotStore';
import { isCoastalSector } from '../config/sectors';
import type { UpperAirLevel } from '../services/synopticRegime';

export function useAloft(): { levels: UpperAirLevel[] | null; coastal: boolean } {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const upperAir = useSpotStore((s) => s.upperAir);
  return useMemo(
    () => ({ levels: upperAir?.sector === sectorId ? upperAir.levels : null, coastal: isCoastalSector(sectorId) }),
    [sectorId, upperAir],
  );
}
