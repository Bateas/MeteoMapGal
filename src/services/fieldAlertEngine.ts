/**
 * Field alert engine — pure functions for agricultural alerts.
 * No store dependencies. Operates on forecast data arrays.
 */

import type { HourlyForecast } from '../types/forecast';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import type { FrostAlert, RainAlert, DroneConditions, FieldAlerts, AlertLevel, WindPropagationInfo, ET0Result, DiseaseRisk } from '../types/campo';
import type { AirspaceCheck } from './airspaceService';
import { msToKnots } from './windUtils';
import { getSunTimes } from './solarUtils';
import { analyzeFog } from './dewPointService';
import { detectWindPropagation } from './windPropagationService';

// ── Frost detection ──────────────────────────────────────

/**
 * Check frost risk in the forecast window.
 * Frost is most likely on clear, calm nights: temp < 2°C, cloudCover < 30%, wind < 2 m/s.
 */
export function checkFrost(forecast: HourlyForecast[], center?: [number, number]): FrostAlert {
  const noAlert: FrostAlert = { level: 'none', minTemp: null, timeWindow: null, cloudCover: null, windSpeed: null };
  if (forecast.length === 0) return noAlert;

  // Focus on nighttime hours (sunset to sunrise+2h)
  const sun = getSunTimes(new Date(), center);
  const nightHours = forecast.filter((p) => {
    const h = p.time.getHours();
    // Rough night window: after sunset or before sunrise+2h
    return h >= sun.sunset.getHours() || h <= sun.sunrise.getHours() + 2;
  });

  if (nightHours.length === 0) return noAlert;

  // Find coldest point with frost conditions
  let coldest: HourlyForecast | null = null;
  let coldestTemp = 999;

  for (const p of nightHours) {
    if (p.temperature === null) continue;
    if (p.temperature < coldestTemp) {
      coldestTemp = p.temperature;
      coldest = p;
    }
  }

  if (!coldest || coldestTemp > 4) return noAlert;

  const cloud = coldest.cloudCover ?? 50;
  const wind = coldest.windSpeed ?? 0;

  // Clear skies + calm wind amplify frost risk
  const clearSky = cloud < 30;
  const calmWind = wind < 2;

  let level: AlertLevel = 'none';
  if (coldestTemp <= 0 && clearSky && calmWind) level = 'critico';
  else if (coldestTemp <= 0) level = 'alto';
  else if (coldestTemp <= 2 && clearSky && calmWind) level = 'alto';
  else if (coldestTemp <= 2) level = 'riesgo';
  else if (coldestTemp <= 4 && clearSky && calmWind) level = 'riesgo';

  if (level === 'none') return noAlert;

  // Build time window around coldest point (±2h)
  const from = new Date(coldest.time.getTime() - 2 * 60 * 60 * 1000);
  const to = new Date(coldest.time.getTime() + 2 * 60 * 60 * 1000);

  return { level, minTemp: coldestTemp, timeWindow: { from, to }, cloudCover: cloud, windSpeed: wind };
}

// ── Rain / hail detection ────────────────────────────────

/**
 * Check rain and hail risk in the forecast window.
 * Hail: CAPE > 1000 + heavy precipitation.
 */
export function checkRainHail(forecast: HourlyForecast[]): RainAlert {
  const noAlert: RainAlert = { level: 'none', maxPrecip: 0, maxProbability: 0, rainAccum6h: 0, hailRisk: false };
  if (forecast.length === 0) return noAlert;

  let maxPrecip = 0;
  let maxProb = 0;
  let hailRisk = false;

  for (const p of forecast) {
    const precip = p.precipitation ?? 0;
    const prob = p.precipProbability ?? 0;
    const cape = p.cape ?? 0;

    if (precip > maxPrecip) maxPrecip = precip;
    if (prob > maxProb) maxProb = prob;

    // Hail conditions: high CAPE + significant precipitation
    if (cape > 1000 && precip > 5) hailRisk = true;
  }

  // 6-hour accumulation from now
  const now = Date.now();
  const sixHoursMs = 6 * 60 * 60 * 1000;
  let rainAccum6h = 0;
  for (const p of forecast) {
    const elapsed = p.time.getTime() - now;
    if (elapsed >= 0 && elapsed <= sixHoursMs) {
      rainAccum6h += p.precipitation ?? 0;
    }
  }
  rainAccum6h = Math.round(rainAccum6h * 10) / 10;

  let level: AlertLevel = 'none';
  if (hailRisk) level = 'critico';
  else if (maxPrecip > 10 || maxProb > 80) level = 'alto';
  else if (maxPrecip > 2 || maxProb > 60) level = 'riesgo';

  return { level, maxPrecip, maxProbability: maxProb, rainAccum6h, hailRisk };
}

// ── Drone flight conditions ──────────────────────────────

/**
 * Check current/near-future conditions for drone flight.
 * Safe: wind < 15 kt, no rain, no nearby storms.
 */
export function checkDroneConditions(
  forecast: HourlyForecast[],
  airspace?: AirspaceCheck,
): DroneConditions {
  const noFly: DroneConditions = {
    flyable: false, windKt: 0, gustKt: 0, rain: false, storms: false, reasons: ['Sin datos de previsión'],
    airspaceRestricted: false, airspaceSeverity: 'none', airspaceReasons: [], activeNotams: 0,
  };
  if (forecast.length === 0) return noFly;

  // Use the first future point (or closest to now)
  const now = Date.now();
  const current = forecast.reduce((closest, p) =>
    Math.abs(p.time.getTime() - now) < Math.abs(closest.time.getTime() - now) ? p : closest
  );

  const windMs = current.windSpeed ?? 0;
  const windKt = msToKnots(windMs);
  const gustMs = current.windGusts ?? 0;
  const gustKt = msToKnots(gustMs);
  const rain = (current.precipitation ?? 0) > 0.2;
  const cape = current.cape ?? 0;
  const storms = cape > 500;

  const reasons: string[] = [];

  if (windKt > 15) reasons.push(`Viento ${windKt.toFixed(0)} kt (max 15 kt)`);
  if (gustKt > 18) reasons.push(`Rachas ${gustKt.toFixed(0)} kt (max 18 kt)`);
  if (rain) reasons.push(`Lluvia prevista (${(current.precipitation ?? 0).toFixed(1)} mm)`);
  if (storms) reasons.push(`Riesgo tormenta (CAPE ${cape.toFixed(0)})`);

  // ── Airspace restrictions ──
  const airspaceReasons: string[] = [];
  let airspaceSeverity: 'none' | 'caution' | 'prohibited' = 'none';
  let activeNotams = 0;

  if (airspace) {
    airspaceSeverity = airspace.severity;
    activeNotams = airspace.notams.length;

    // Add zone restrictions to reasons
    for (const zone of airspace.zones) {
      if (zone.type.toUpperCase().includes('PROHIB')) {
        reasons.push(`Zona prohibida: ${zone.name}`);
        airspaceReasons.push(`Zona prohibida: ${zone.name}`);
      } else {
        airspaceReasons.push(`Requiere autorización: ${zone.name}`);
      }
    }

    // Add NOTAM restrictions
    for (const notam of airspace.notams) {
      if (notam.severity === 'prohibited') {
        reasons.push(`NOTAM: ${notam.description.slice(0, 80)}`);
        airspaceReasons.push(`NOTAM ${notam.id}: ${notam.description.slice(0, 80)}`);
      } else if (notam.severity === 'caution') {
        airspaceReasons.push(`NOTAM ${notam.id}: ${notam.description.slice(0, 80)}`);
      }
    }
  }

  const flyable = reasons.length === 0;

  return {
    flyable, windKt, gustKt, rain, storms, reasons,
    airspaceRestricted: airspace?.restricted ?? false,
    airspaceSeverity,
    airspaceReasons,
    activeNotams,
  };
}

// ── Evapotranspiration (Hargreaves-Samani simplified) ────

/**
 * Estimate daily reference ET₀ using Hargreaves-Samani method.
 * Uses forecast Tmax/Tmin + solar radiation. Wind/humidity correction applied.
 * @param forecast - next 24h of hourly data
 */
export function computeET0(forecast: HourlyForecast[]): ET0Result {
  const noData: ET0Result = { et0Daily: null, irrigationAdvice: 'Sin datos suficientes', level: 'none' };
  if (forecast.length < 12) return noData;

  // Next 24h slice
  const now = Date.now();
  const day = forecast.filter((p) => {
    const dt = p.time.getTime() - now;
    return dt >= 0 && dt <= 24 * 60 * 60 * 1000;
  });
  if (day.length < 8) return noData;

  const temps = day.map((p) => p.temperature).filter((t): t is number => t !== null);
  if (temps.length < 4) return noData;

  const tMax = Math.max(...temps);
  const tMin = Math.min(...temps);
  const tMean = (tMax + tMin) / 2;
  const tRange = tMax - tMin;

  // Hargreaves-Samani: ET₀ = 0.0023 × (Tmean + 17.8) × √(Tmax - Tmin) × Ra
  // Ra ≈ estimated from solar radiation average (W/m² → MJ/m²/day)
  const solarVals = day.map((p) => p.solarRadiation).filter((s): s is number => s !== null);
  // If no solar data, estimate Ra from latitude ~42° (Galicia) — ~20 MJ/m²/day summer, ~8 winter
  const month = new Date().getMonth(); // 0-11
  const defaultRa = [8, 10, 14, 18, 22, 24, 24, 22, 17, 12, 9, 7][month];
  const ra = solarVals.length > 4
    ? (solarVals.reduce((a, b) => a + b, 0) / solarVals.length) * 0.0864 // W/m² → MJ/m²/day
    : defaultRa;

  let et0 = 0.0023 * (tMean + 17.8) * Math.sqrt(Math.max(tRange, 0.1)) * (ra / 2.45);

  // Wind correction: high wind increases ET (+10% per m/s above 2)
  const winds = day.map((p) => p.windSpeed).filter((w): w is number => w !== null);
  const avgWind = winds.length > 0 ? winds.reduce((a, b) => a + b, 0) / winds.length : 0;
  if (avgWind > 2) et0 *= 1 + 0.1 * (avgWind - 2);

  // Humidity correction: high humidity decreases ET (-5% per 10% above 60)
  const hums = day.map((p) => p.humidity).filter((h): h is number => h !== null);
  const avgHum = hums.length > 0 ? hums.reduce((a, b) => a + b, 0) / hums.length : 60;
  if (avgHum > 60) et0 *= Math.max(0.5, 1 - 0.005 * (avgHum - 60));

  et0 = Math.round(et0 * 10) / 10;

  let level: AlertLevel = 'none';
  let irrigationAdvice: string;

  if (et0 >= 6) {
    level = 'critico';
    irrigationAdvice = 'Demanda hídrica MUY ALTA. Riego urgente recomendado.';
  } else if (et0 >= 4) {
    level = 'alto';
    irrigationAdvice = 'Demanda hídrica alta. Considerar riego suplementario.';
  } else if (et0 >= 2) {
    level = 'riesgo';
    irrigationAdvice = 'Demanda hídrica moderada. Monitorizar humedad del suelo.';
  } else {
    irrigationAdvice = 'Demanda hídrica baja. Sin necesidad de riego adicional.';
  }

  return { et0Daily: et0, irrigationAdvice, level };
}

// ── Disease risk (grapevine: mildiu + oídio) ────────────

/**
 * Evaluate phytosanitary risk for grapevine diseases in the next 24h.
 * - Mildiu (downy mildew): T > 10°C + HR > 90% + rain present
 * - Oídio (powdery mildew): T 15-25°C + HR > 70% + no rain
 */
export function checkDiseaseRisk(forecast: HourlyForecast[]): DiseaseRisk {
  const noRisk: DiseaseRisk = {
    mildiu: { risk: false, level: 'none', hours: 0, detail: 'Sin condiciones favorables' },
    oidio: { risk: false, level: 'none', hours: 0, detail: 'Sin condiciones favorables' },
  };
  if (forecast.length < 8) return noRisk;

  const now = Date.now();
  const next24h = forecast.filter((p) => {
    const dt = p.time.getTime() - now;
    return dt >= 0 && dt <= 24 * 60 * 60 * 1000;
  });

  let mildiuHours = 0;
  let oidioHours = 0;

  for (const p of next24h) {
    const t = p.temperature;
    const h = p.humidity;
    const rain = (p.precipitation ?? 0) > 0.1;

    if (t === null || h === null) continue;

    // Mildiu: warm + very humid + rain
    if (t > 10 && h > 90 && rain) mildiuHours++;

    // Oídio: moderate temp + high humidity + DRY
    if (t >= 15 && t <= 25 && h > 70 && !rain) oidioHours++;
  }

  // Severity mapping
  function diseaseLevel(hours: number): AlertLevel {
    if (hours >= 6) return 'critico';
    if (hours >= 4) return 'alto';
    if (hours >= 2) return 'riesgo';
    return 'none';
  }

  const mildiuLevel = diseaseLevel(mildiuHours);
  const oidioLevel = diseaseLevel(oidioHours);

  return {
    mildiu: {
      risk: mildiuHours >= 2,
      level: mildiuLevel,
      hours: mildiuHours,
      detail: mildiuHours >= 2
        ? `${mildiuHours}h con T>10°C + HR>90% + lluvia en próximas 24h`
        : 'Sin condiciones favorables para mildiu',
    },
    oidio: {
      risk: oidioHours >= 2,
      level: oidioLevel,
      hours: oidioHours,
      detail: oidioHours >= 2
        ? `${oidioHours}h con T 15-25°C + HR>70% sin lluvia en próximas 24h`
        : 'Sin condiciones favorables para oídio',
    },
  };
}

// ── Combined check ───────────────────────────────────────

/**
 * Run all field alert checks.
 * @param forecast - hourly forecast data (from Open-Meteo)
 * @param readingHistory - real station readings (from weatherStore) for dew point/fog analysis
 * @param stations - station metadata (for wind propagation spatial analysis)
 * @param currentReadings - latest readings per station (for wind propagation)
 */
export function checkAllFieldAlerts(
  forecast: HourlyForecast[],
  readingHistory?: Map<string, NormalizedReading[]>,
  stations?: NormalizedStation[],
  currentReadings?: Map<string, NormalizedReading>,
  center?: [number, number],
  airspace?: AirspaceCheck,
): FieldAlerts {
  const frost = checkFrost(forecast, center);
  const rain = checkRainHail(forecast);
  const drone = checkDroneConditions(forecast, airspace);
  const fog = analyzeFog(readingHistory ?? new Map(), new Date(), forecast);
  const et0 = computeET0(forecast);
  const disease = checkDiseaseRisk(forecast);

  // Wind propagation detection (needs stations + current + history)
  let wind: WindPropagationInfo = {
    active: false,
    directionLabel: '--',
    upwindCount: 0,
    avgIncreaseKt: 0,
    frontSpeedKt: 0,
    estimatedArrivalMin: null,
    confidence: 0,
    summary: 'Sin datos de estaciones',
  };

  if (stations && currentReadings && readingHistory) {
    const propagation = detectWindPropagation(stations, currentReadings, readingHistory);
    wind = {
      active: propagation.active,
      directionLabel: propagation.directionLabel,
      upwindCount: propagation.upwindStations.length,
      avgIncreaseKt: msToKnots(propagation.avgSpeedIncrease),
      frontSpeedKt: msToKnots(propagation.frontSpeed),
      estimatedArrivalMin: propagation.estimatedArrivalMin,
      confidence: propagation.confidence,
      summary: propagation.summary,
    };
  }

  const levels: AlertLevel[] = [frost.level, rain.level, fog.level, et0.level, disease.mildiu.level, disease.oidio.level];
  const priority: Record<AlertLevel, number> = { none: 0, riesgo: 1, alto: 2, critico: 3 };
  const maxLevel = levels.reduce<AlertLevel>((max, l) => priority[l] > priority[max] ? l : max, 'none');

  return { frost, rain, fog, drone, wind, et0, disease, maxLevel };
}
