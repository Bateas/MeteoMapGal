/**
 * Solar position utilities for sunrise/sunset calculation.
 * Uses simplified astronomical formulas (accuracy ±1 min).
 */

import { MAP_CENTER } from '../config/constants';

const DEFAULT_CENTER = MAP_CENTER;
const DEG = Math.PI / 180;

interface SunTimes {
  sunrise: Date;
  sunset: Date;
  solarNoon: Date;
  dayLengthMin: number;
  /** Best thermal window: ~2h after solar noon until ~1h before sunset */
  thermalStart: Date;
  thermalEnd: Date;
}

/**
 * Calculate sunrise, sunset and thermal window for a given date.
 * Based on NOAA solar calculator equations.
 * @param date — target day (defaults to today)
 * @param center — [lon, lat] for the calculation (defaults to MAP_CENTER)
 */
/**
 * Height of the sun above the horizon (degrees; negative below it) at an instant and place.
 * NOAA's general solar position formulas (a fraction of a degree, plenty to tell night, dawn and
 * midday). Thresholds on solar radiation should be relative to this, not absolute: on the eclipse
 * of 12-ago every fixed W/m2 threshold mistook the evening for a storm shadow.
 */
export function solarElevationDeg(ms: number, lat: number, lon: number): number {
  const d = new Date(ms);
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((ms - startOfYear) / 86_400_000) + 1;
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hour - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqTimeMin = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const solarTimeMin = hour * 60 + eqTimeMin + 4 * lon;
  const hourAngle = (solarTimeMin / 4 - 180) * DEG;
  const cosZenith = Math.sin(lat * DEG) * Math.sin(decl) + Math.cos(lat * DEG) * Math.cos(decl) * Math.cos(hourAngle);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) / DEG;
}

export function getSunTimes(date: Date = new Date(), center?: [number, number]): SunTimes {
  const [LON, LAT] = center ?? DEFAULT_CENTER;
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // Julian day
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const jd =
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045;

  // Julian century from J2000.0
  const jc = (jd - 2451545.0) / 36525.0;

  // Solar geometry
  const geomMeanLongSun = (280.46646 + jc * (36000.76983 + 0.0003032 * jc)) % 360;
  const geomMeanAnomSun = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const eccentEarthOrbit = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);

  const sunEqOfCenter =
    Math.sin(geomMeanAnomSun * DEG) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * geomMeanAnomSun * DEG) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * geomMeanAnomSun * DEG) * 0.000289;

  const sunTrueLong = geomMeanLongSun + sunEqOfCenter;
  const sunAppLong = sunTrueLong - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * jc) * DEG);

  const meanObliqEcliptic = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliqEcliptic + 0.00256 * Math.cos((125.04 - 1934.136 * jc) * DEG);

  const sunDeclin = Math.asin(Math.sin(obliqCorr * DEG) * Math.sin(sunAppLong * DEG)) / DEG;

  const varY = Math.tan((obliqCorr / 2) * DEG) * Math.tan((obliqCorr / 2) * DEG);
  const eqOfTime =
    4 *
    (varY * Math.sin(2 * geomMeanLongSun * DEG) -
      2 * eccentEarthOrbit * Math.sin(geomMeanAnomSun * DEG) +
      4 * eccentEarthOrbit * varY * Math.sin(geomMeanAnomSun * DEG) * Math.cos(2 * geomMeanLongSun * DEG) -
      0.5 * varY * varY * Math.sin(4 * geomMeanLongSun * DEG) -
      1.25 * eccentEarthOrbit * eccentEarthOrbit * Math.sin(2 * geomMeanAnomSun * DEG)) /
    DEG;

  // Hour angle for sunrise/sunset (standard: -0.833° for atmospheric refraction)
  const ha =
    Math.acos(
      (Math.cos(90.833 * DEG) / (Math.cos(LAT * DEG) * Math.cos(sunDeclin * DEG))) -
        Math.tan(LAT * DEG) * Math.tan(sunDeclin * DEG)
    ) / DEG;

  // Solar noon (minutes from midnight UTC)
  const solarNoonMin = 720 - 4 * LON - eqOfTime;

  // Sunrise/sunset in minutes from midnight UTC
  const sunriseMin = solarNoonMin - ha * 4;
  const sunsetMin = solarNoonMin + ha * 4;

  // Convert to Date objects (same day as input)
  const baseDate = new Date(date);
  baseDate.setUTCHours(0, 0, 0, 0);

  const sunrise = new Date(baseDate.getTime() + sunriseMin * 60 * 1000);
  const sunset = new Date(baseDate.getTime() + sunsetMin * 60 * 1000);
  const solarNoon = new Date(baseDate.getTime() + solarNoonMin * 60 * 1000);

  const dayLengthMin = sunsetMin - sunriseMin;

  // Thermal window: peak heating ~2h after solar noon, ends ~1h before sunset
  const thermalStart = new Date(solarNoon.getTime() + 2 * 60 * 60 * 1000);
  const thermalEnd = new Date(sunset.getTime() - 1 * 60 * 60 * 1000);

  return { sunrise, sunset, solarNoon, dayLengthMin, thermalStart, thermalEnd };
}

/** Format time as HH:MM in local timezone */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

/** Check if current time is during daylight */
export function isDaylight(now: Date = new Date(), center?: [number, number]): boolean {
  const { sunrise, sunset } = getSunTimes(now, center);
  return now >= sunrise && now <= sunset;
}
