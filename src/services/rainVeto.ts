/**
 * Rain veto for the Cesantes thermal breeze.
 *
 * The breeze needs a thermal low inland, and rain means there is none: the sun is
 * not heating the land. A warm afternoon and a big air-water ΔT can still say
 * "breeze" on a showery day: 26-ago 17:20, 9kt at the stations and rain at two of
 * them, and the thermal mode alone would have announced 14kt. Rigour rule: one wet
 * gauge can be a sprinkler, a drip or a counter reset, so it takes two.
 *
 * Rain only, on purpose: no lightning leg.
 */

import { rainInWindowMm, type PrecipSample } from './precipSemantics';

export const RAIN_VETO_WINDOW_MIN = 120;
export const RAIN_VETO_MM = 0.2;
export const RAIN_VETO_MIN_WET_STATIONS = 2;

export interface RainVeto {
  vetoed: boolean;
  reason: string | null;
  /** Stations that measured at least RAIN_VETO_MM in the window, wettest first */
  wetStations: { id: string; mm: number }[];
}

/** Whether rain at the spot's stations vetoes the thermal breeze. No data = no veto. */
export function assessRainVeto(a: {
  stationIds: string[];
  precip: Map<string, PrecipSample[]>;
  nowMs: number;
}): RainVeto {
  const wetStations: { id: string; mm: number }[] = [];
  for (const id of new Set(a.stationIds)) {
    const samples = a.precip.get(id);
    if (!samples || samples.length === 0) continue;
    const mm = rainInWindowMm(id, samples, a.nowMs, RAIN_VETO_WINDOW_MIN);
    if (mm != null && mm >= RAIN_VETO_MM) wetStations.push({ id, mm });
  }
  wetStations.sort((x, y) => y.mm - x.mm);
  const n = wetStations.length;
  const vetoed = n >= RAIN_VETO_MIN_WET_STATIONS;
  return {
    vetoed,
    reason: vetoed ? `Lluvia en ${n} estaciones cercanas en las 2 últimas horas: sin brisa canalizada` : null,
    wetStations,
  };
}
