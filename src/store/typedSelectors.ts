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

export const useWeather = createSelectors(useWeatherStore);
export const useBuoy = createSelectors(useBuoyStore);
export const useSpot = createSelectors(useSpotStore);
export const useSector = createSelectors(useSectorStore);
export const useToast = createSelectors(useToastStore);
export const useAlert = createSelectors(useAlertStore);
