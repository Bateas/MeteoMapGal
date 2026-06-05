/**
 * Typed selector wrappers for Zustand stores.
 *
 * Compile-time safety: `useWeather.use.wrongName()` → TS error. The original
 * stores still work for backward compat (`useWeatherStore((s) => s.x)`).
 *
 * Why: ConditionsTicker v1.21.0 crash — `s.readings` returned undefined
 * because weatherStore has `currentReadings`, not `readings`. TypeScript
 * didn't catch it. These wrappers make wrong names a compile error.
 *
 * Usage:
 *   import { useWeather, useBuoy, useSpot } from '../store/typedSelectors';
 *   const readings = useWeather.use.currentReadings();
 */
import { createSelectors } from './createSelectors';
import { useWeatherStore } from './weatherStore';
import { useBuoyStore } from './buoyStore';
import { useSpotStore } from './spotStore';

export const useWeather = createSelectors(useWeatherStore);
export const useBuoy = createSelectors(useBuoyStore);
export const useSpot = createSelectors(useSpotStore);
