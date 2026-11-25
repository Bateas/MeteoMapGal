/**
 * useConditionsList: the one list of Condiciones, from the stores. Read by the drawer, the strip on
 * the map and the dot in the header, so the three say the same thing. No fetches of its own.
 */
import { useMemo } from 'react';
import { useAlertStore } from '../store/alertStore';
import { useAirQualityStore } from '../store/airQualityStore';
import { useIcaStore } from '../store/icaStore';
import { useFireStore } from '../store/fireStore';
import { selectFireClusters } from '../services/fireClustering';
import { aggregateFiresForSector } from '../services/fireService';
import { useSectorStore } from '../store/sectorStore';
import { useWeatherStore } from '../store/weatherStore';
import { useForecastStore } from './useForecastTimeline';
import { useLightningStore } from './useLightningData';
import { useWarningsStore } from './useWarnings';
import { mgWarningsLastOkMs } from '../api/mgWarningsClient';
import { buildConditionsList, type ConditionsList } from '../services/alerts/conditionsList';
import { officialWarningsKnown } from '../services/alerts/officialKnown';
import { classifyHaze } from '../services/hazeService';
import { minVisibilityKm, selectRelevantVisibility, SECTOR_VISIBILITY_RADIUS_FACTOR } from '../services/visibilityFreshness';

/** Lightning is polled every 1-2 min: a quarter of an hour failing means we do not know. */
export const LIGHTNING_MAX_SILENCE_MS = 15 * 60_000;

/**
 * Whether the lightning state is unknown: failing now, and no good answer for a while. Before, only a server
 * that never answered counted, so one that went down after the first answer left «Nada que avisar» for hours
 * (review, 18-nov).
 */
export function lightningUnknownAt(lastOk: Date | null, error: string | null, nowMs: number): boolean {
  if (error === null) return false;
  return lastOk === null || nowMs - lastOk.getTime() > LIGHTNING_MAX_SILENCE_MS;
}

export function useConditionsList(): ConditionsList {
  const alerts = useAlertStore((s) => s.alerts);
  const mg = useWarningsStore((s) => s.sectorWarnings);
  const ipma = useWarningsStore((s) => s.ipmaSectorWarnings);
  const warningsPolled = useWarningsStore((s) => s.lastFetch);
  // Recomputed on every poll (each one sets error or lastFetch), so the clock inside is fresh enough
  const lightningUnknown = useLightningStore((s) => lightningUnknownAt(s.lastFetch, s.error, Date.now()));
  const hourly = useForecastStore((s) => s.hourly);
  const convectionData = useForecastStore((s) => s.convectionData);
  const air = useAirQualityStore((s) => s.data);
  const ica = useIcaStore((s) => s.readings);
  const fires = useFireStore((s) => s.fires);
  const visibility = useWeatherStore((s) => s.visibilityReadings);
  const sector = useSectorStore((s) => s.activeSector);

  return useMemo(() => {
    const now = new Date();
    const [lon, lat] = sector.center;
    // Same gates as the old tint: only fresh visibility from near this sector can support calima.
    const relevant = selectRelevantVisibility(visibility, lat, lon, sector.radiusKm * SECTOR_VISIBILITY_RADIUS_FACTOR);
    return buildConditionsList({
      alerts,
      mg,
      ipma,
      officialKnown: officialWarningsKnown(warningsPolled, mgWarningsLastOkMs(), now.getTime()),
      lightningKnown: !lightningUnknown,
      hourly,
      convection: convectionData.length > 0 ? convectionData : hourly,
      haze: air ? classifyHaze(air.dust, air.aerosolOpticalDepth, minVisibilityKm(relevant.values())) : null,
      dust: air?.dust,
      aod: air?.aerosolOpticalDepth,
      ica,
      fires: aggregateFiresForSector(selectFireClusters(fires), sector.center),
      center: sector.center,
      radiusKm: sector.radiusKm,
      sectorName: sector.shortName,
      now,
    });
  }, [alerts, mg, ipma, warningsPolled, lightningUnknown, hourly, convectionData, air, ica, fires, visibility, sector]);
}
