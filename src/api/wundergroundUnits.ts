/**
 * Wunderground observations, asked in metric units (`units=m`): wind in km/h, temperature in °C,
 * pressure in hPa, rain in mm. Shared by the ingestor and the map so the two read the same thing.
 *
 * Why not `units=s` (m/s), as before 15-oct: WU gives the wind in WHOLE m/s there. In 6 h,
 * 7.241 readings with no decimals and half of them 0; the same station read 0 m/s and 1 km/h at
 * the same instant. In km/h the step is 0,28 m/s (0,5 kt) instead of 1 m/s (2 kt). WU rounds, it
 * does not truncate (15 of 16 pairs checked), so the calibration measured on the old data carries
 * no bias, only grain.
 */

export const WU_UNITS = 'm';

/** The block WU returns under `metric` when asked with units=m. */
export interface WuMetric {
  temp: number | null;
  windSpeed: number | null;     // km/h
  windGust: number | null;      // km/h
  pressure: number | null;      // hPa
  precipRate: number | null;    // mm/h
  precipTotal: number | null;   // mm
  elev: number | null;          // m
  dewpt: number | null;         // °C
}

export function wuKmhToMs(kmh: number | null | undefined): number | null {
  if (kmh == null || !Number.isFinite(kmh) || kmh < 0) return null;
  return Math.round((kmh / 3.6) * 100) / 100;
}

/** The fields of a reading that come from the metric block, wind already in m/s. */
export function wuMetricFields(m: WuMetric | null | undefined): {
  windSpeed: number | null; windGust: number | null; temperature: number | null;
  precipitation: number | null; pressure: number | null; dewPoint: number | null;
} {
  return {
    windSpeed: wuKmhToMs(m?.windSpeed),
    windGust: wuKmhToMs(m?.windGust),
    temperature: m?.temp ?? null,
    precipitation: m?.precipTotal ?? null,
    pressure: m?.pressure ?? null,
    dewPoint: m?.dewpt ?? null,
  };
}
