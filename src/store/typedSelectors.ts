/**
 * Typed selector wrappers for Zustand stores.
 *
 * These provide compile-time safety: `useWeather.use.wrongName()` → TS error.
 * Original stores still work for backward compat: `useWeatherStore((s) => s.x)`
 *
 * Usage in new components:
 *   import { useWeather, useBuoy, useSpot, useSector } from '../store/typedSelectors';
 *   const readings = useWeather.use.currentReadings();
 *   const buoys = useBuoy.use.buoys();
 *   const scores = useSpot.use.scores();
 *
 * Why: ConditionsTicker v1.21.0 crash — `s.readings` returned undefined
 * because weatherStore has `currentReadings`, not `readings`. TypeScript
 * didn't catch it. These wrappers make wrong names a compile error.
 */
import { createSelectors } from './createSelectors';
import { useWeatherStore } from './weatherStore';
import { useBuoyStore } from './buoyStore';
import { useSpotStore } from './spotStore';
import { useSectorStore } from './sectorStore';
import { useToastStore } from './toastStore';
import { useAlertStore } from './alertStore';
import type { AlertSeverity } from '../services/alertService';

export const useWeather = createSelectors(useWeatherStore);
export const useBuoy = createSelectors(useBuoyStore);
export const useSpot = createSelectors(useSpotStore);
export const useSector = createSelectors(useSectorStore);
export const useToast = createSelectors(useToastStore);
export const useAlert = createSelectors(useAlertStore);

// ── Computed selectors ──────────────────────────────────────
// Derived values that multiple components currently re-compute inline.
// These are standard React hooks that subscribe to the minimal slice needed.

/**
 * Returns the highest alert severity across all active alerts.
 * Maps AlertSeverity → UI severity labels used by Header/FieldDrawer.
 *
 * Currently computed inline in:
 *   - AppShell.tsx (fieldAlertLevel prop derivation)
 *   - FieldDrawer.tsx (airspace severity mapping)
 */
const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  moderate: 1,
  high: 2,
  critical: 3,
};

export type MaxAlertLevel = 'none' | 'riesgo' | 'alto' | 'critico';

export function useMaxAlertLevel(): MaxAlertLevel {
  const alerts = useAlertStore((s) => s.alerts);

  if (alerts.length === 0) return 'none';

  let maxRank = 0;
  for (const a of alerts) {
    const rank = SEVERITY_RANK[a.severity] ?? 0;
    if (rank > maxRank) maxRank = rank;
  }

  switch (maxRank) {
    case 3: return 'critico';
    case 2: return 'alto';
    case 1: return 'riesgo';
    default: return 'none';
  }
}

/**
 * Returns only non-info alerts (severity > 'info').
 * Equivalent to filtering by activeCount logic in computeCompositeRisk.
 *
 * Currently computed inline in:
 *   - AlertPanel.tsx (filters drone category, checks length)
 *   - CriticalAlertBanner.tsx (filters severity === 'critical')
 */
export function useActiveAlerts() {
  return useAlertStore((s) => s.alerts.filter((a) => a.severity !== 'info'));
}

/**
 * Returns station count summary: total stations and how many have readings.
 *
 * Currently computed inline in:
 *   - Header.tsx (stations.length + currentReadings.size)
 *   - AppShell.tsx (stations.length, currentReadings.size)
 *   - LoadingScreen.tsx (stations.length, currentReadings.size)
 *   - ConditionsTicker.tsx (stations.length)
 */
export function useStationCount(): { total: number; withReadings: number } {
  const total = useWeatherStore((s) => s.stations.length);
  const withReadings = useWeatherStore((s) => s.currentReadings.size);
  return { total, withReadings };
}
