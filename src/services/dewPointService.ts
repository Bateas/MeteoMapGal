/**
 * Dew point and fog prediction based on REAL measured station data.
 *
 * Philosophy: all predictions are hypotheses derived from actual readings
 * (temperature, humidity, wind) collected over the past hours — NOT from
 * external forecast APIs (AEMET, Open-Meteo, Windguru, etc.).
 *
 * Key concepts:
 * - Dew point (Td): temperature at which air becomes saturated.
 * - Spread (T - Td): when this approaches 0, fog/dew forms.
 * - Trend: rate of change of the spread over time → predicts convergence.
 */

import type { NormalizedReading } from '../types/station';
import type { HourlyForecast } from '../types/forecast';
import type { FogAlert, AlertLevel } from '../types/campo';
import { detectNorthWindConsensus } from './maritimeFogService';

// ── Magnus formula constants (Buck, 1981) ────────────────

const B = 17.67;
const C = 243.5; // °C

// ── Pure calculations ────────────────────────────────────

/**
 * Calculate dew point from temperature and relative humidity.
 * Uses the Magnus–Tetens approximation.
 *   γ = ln(RH/100) + (B·T)/(C+T)
 *   Td = (C·γ)/(B−γ)
 */
export function calculateDewPoint(tempC: number, humidityPct: number): number {
  const rh = Math.max(1, Math.min(100, humidityPct)); // clamp 1-100
  const gamma = Math.log(rh / 100) + (B * tempC) / (C + tempC);
  return (C * gamma) / (B - gamma);
}

/** Dew point spread = T − Td. When 0, fog/dew forms. */
export function calculateSpread(tempC: number, humidityPct: number): number {
  return tempC - calculateDewPoint(tempC, humidityPct);
}

// ── Trend analysis on real readings ──────────────────────

interface SpreadPoint {
  time: Date;
  spread: number;
  temp: number;
  humidity: number;
  dewPoint: number;
}

/**
 * Build a time series of dew point spreads from real station readings.
 * Filters out readings without both temperature and humidity.
 */
function buildSpreadSeries(readings: NormalizedReading[]): SpreadPoint[] {
  const points: SpreadPoint[] = [];
  for (const r of readings) {
    if (r.temperature === null || r.humidity === null) continue;
    const dp = calculateDewPoint(r.temperature, r.humidity);
    points.push({
      time: r.timestamp,
      spread: r.temperature - dp,
      temp: r.temperature,
      humidity: r.humidity,
      dewPoint: dp,
    });
  }
  return points.sort((a, b) => a.time.getTime() - b.time.getTime());
}

/**
 * Calculate the linear trend of the spread over a time window.
 * Returns °C/hour (negative = converging → fog approaching).
 * Uses least-squares linear regression.
 */
function calculateSpreadTrend(series: SpreadPoint[]): number | null {
  if (series.length < 3) return null;

  const n = series.length;
  const t0 = series[0].time.getTime();
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

  for (const pt of series) {
    const x = (pt.time.getTime() - t0) / 3_600_000; // hours since first point
    const y = pt.spread;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return null;

  return (n * sumXY - sumX * sumY) / denom; // slope in °C/h
}

// ── Fog prediction engine ────────────────────────────────

/**
 * Analyze fog probability from real station readings.
 *
 * Uses the REAL measured data to:
 * 1. Calculate current dew point and spread
 * 2. Compute the trend of the spread over the last hours
 * 3. Extrapolate when spread might reach 0 (fog formation)
 * 4. Factor in wind speed (calm = fog-favorable) and time of day
 *
 * @param allReadings - Map of stationId → reading history (from weatherStore)
 * @param now - current time (for testability)
 */
/**
 * Enhanced fog analysis: cross-references real station readings with
 * Open-Meteo forecast for improved confidence and earlier ETA predictions.
 *
 * Forecast data adds:
 * - Future humidity trend (will HR keep climbing?)
 * - Cloud cover forecast (clear nights → fog, overcast → less likely)
 * - Wind forecast (will it stay calm?)
 *
 * Wind direction suppression:
 * - Continental wind (N/NE/NW, 315°-80°) with speed >2 m/s and HR <78% → fog impossible
 * - Any direction with speed >3 m/s and HR <75% → fog suppressed
 *
 * Solar suppression:
 * - Solar radiation >200 W/m² during day → fog dissipated, suppress alert
 */
export function analyzeFog(
  allReadings: Map<string, NormalizedReading[]>,
  now: Date = new Date(),
  forecast?: HourlyForecast[],
  currentReadings?: Map<string, NormalizedReading>,
): FogAlert {
  const noFog: FogAlert = {
    level: 'none',
    dewPoint: null,
    spread: null,
    spreadTrend: null,
    fogEta: null,
    humidity: null,
    windSpeed: null,
    confidence: 0,
    hypothesis: 'Sin datos suficientes',
  };

  // ── Global north wind suppression ──────────────────────────
  // A sector-wide N/NE consensus means dry continental air — fog impossible.
  // This catches cases where individual station checks miss (e.g. moderate HR 78-85%).
  if (currentReadings && detectNorthWindConsensus(currentReadings)) {
    return {
      ...noFog,
      hypothesis: 'Niebla suprimida: norte claro en estaciones del sector — aire continental seco',
    };
  }

  // Aggregate readings from all stations in the last 6 hours
  const cutoff = new Date(now.getTime() - 6 * 3_600_000);
  const recentReadings: NormalizedReading[] = [];

  for (const [, stationHistory] of allReadings) {
    for (const r of stationHistory) {
      if (r.timestamp >= cutoff && r.temperature !== null && r.humidity !== null) {
        recentReadings.push(r);
      }
    }
  }

  if (recentReadings.length < 3) return noFog;

  // Build spread series from ALL stations (gives a zone-wide picture)
  const series = buildSpreadSeries(recentReadings);
  if (series.length < 3) return noFog;

  // Current values: use the most recent reading
  const latest = series[series.length - 1];
  const currentSpread = latest.spread;
  const currentDewPoint = latest.dewPoint;
  const currentHumidity = latest.humidity;

  // Current wind: average of the most recent readings from each station
  const latestByStation = new Map<string, NormalizedReading>();
  for (const r of recentReadings) {
    const existing = latestByStation.get(r.stationId);
    if (!existing || r.timestamp > existing.timestamp) {
      latestByStation.set(r.stationId, r);
    }
  }
  const windSpeeds = [...latestByStation.values()]
    .map((r) => r.windSpeed)
    .filter((w): w is number => w !== null);
  const avgWind = windSpeeds.length > 0
    ? windSpeeds.reduce((a, b) => a + b, 0) / windSpeeds.length
    : null;

  // Wind direction: circular mean of latest readings with valid wind
  const windDirReadings = [...latestByStation.values()]
    .filter((r) => r.windDirection !== null && r.windSpeed !== null && r.windSpeed >= 1.5);
  let avgWindDir: number | null = null;
  if (windDirReadings.length >= 2) {
    const sinSum = windDirReadings.reduce((s, r) => s + Math.sin(r.windDirection! * Math.PI / 180), 0);
    const cosSum = windDirReadings.reduce((s, r) => s + Math.cos(r.windDirection! * Math.PI / 180), 0);
    avgWindDir = ((Math.atan2(sinSum, cosSum) * 180 / Math.PI) + 360) % 360;
  }

  // Solar radiation: average of latest readings (for daytime fog suppression)
  const solarReadings = [...latestByStation.values()]
    .map((r) => r.solarRadiation)
    .filter((s): s is number => s !== null);
  const avgSolar = solarReadings.length >= 2
    ? solarReadings.reduce((a, b) => a + b, 0) / solarReadings.length
    : null;

  // Average humidity from latest readings
  const humidityReadings = [...latestByStation.values()]
    .map((r) => r.humidity)
    .filter((h): h is number => h !== null);
  const avgHumidity = humidityReadings.length > 0
    ? humidityReadings.reduce((a, b) => a + b, 0) / humidityReadings.length
    : null;

  // ── Fog suppression checks (before any level assignment) ──
  // Max gust from any station — unambiguous wind signal
  const allGusts = [...latestByStation.values()]
    .map((r) => r.windGust ?? r.windSpeed)
    .filter((g): g is number => g !== null && g > 0);
  const maxGust = allGusts.length > 0 ? Math.max(...allGusts) : 0;

  // If ANY station has gusts > 5 m/s (~10kt), no fog is possible regardless
  if (maxGust >= 5.0) {
    return {
      level: 'none',
      dewPoint: currentDewPoint,
      spread: currentSpread,
      spreadTrend: null,
      fogEta: null,
      humidity: currentHumidity,
      windSpeed: avgWind,
      confidence: 0,
      hypothesis: `Niebla suprimida: rachas ${(maxGust * 1.94).toFixed(0)}kt — viento impide formación`,
    };
  }

  // Continental dry wind: N/NE/NW (315°-80°) + speed/gust check + HR < 78%
  const isContinentalWind = avgWindDir !== null && (avgWindDir >= 315 || avgWindDir <= 80);
  const medianWind = windSpeeds.length >= 3
    ? [...windSpeeds].sort((a, b) => a - b)[Math.floor(windSpeeds.length / 2)]
    : avgWind;
  const effectiveWind = Math.max(medianWind ?? 0, maxGust * 0.7);
  const isDryWind = effectiveWind >= 2.5 && avgHumidity !== null && avgHumidity < 78;
  const fogSuppressedByWind =
    (isContinentalWind && isDryWind) ||
    (effectiveWind > 4 && avgHumidity !== null && avgHumidity < 72);

  // Solar suppression: radiation > 200 W/m² → fog dissipated (daytime only)
  const fogSuppressedBySolar = avgSolar !== null && avgSolar > 200;

  if (fogSuppressedByWind || fogSuppressedBySolar) {
    const suppressNotes: string[] = [];
    if (fogSuppressedByWind && isContinentalWind) {
      suppressNotes.push(`viento continental ${avgWindDir!.toFixed(0)}° ${avgWind!.toFixed(1)} m/s`);
    } else if (fogSuppressedByWind) {
      suppressNotes.push(`viento seco ${avgWind!.toFixed(1)} m/s HR ${avgHumidity!.toFixed(0)}%`);
    }
    if (fogSuppressedBySolar) {
      suppressNotes.push(`radiación solar ${avgSolar!.toFixed(0)} W/m²`);
    }
    return {
      level: 'none',
      dewPoint: currentDewPoint,
      spread: currentSpread,
      spreadTrend: null,
      fogEta: null,
      humidity: currentHumidity,
      windSpeed: avgWind,
      confidence: 0,
      hypothesis: `Niebla suprimida: ${suppressNotes.join(' · ')}`,
    };
  }

  // Trend: use readings from the last 3-4 hours for a stable trend
  const trendCutoff = new Date(now.getTime() - 4 * 3_600_000);
  const trendSeries = series.filter((p) => p.time >= trendCutoff);
  const spreadTrend = calculateSpreadTrend(trendSeries.length >= 3 ? trendSeries : series);

  // Time span of data available (for confidence scoring)
  const dataSpanHours = (series[series.length - 1].time.getTime() - series[0].time.getTime()) / 3_600_000;

  // Confidence: based on data quantity and span
  let confidence = 0;
  if (series.length >= 10) confidence += 30;
  else if (series.length >= 5) confidence += 20;
  else confidence += 10;

  if (dataSpanHours >= 3) confidence += 30;
  else if (dataSpanHours >= 1.5) confidence += 20;
  else confidence += 10;

  // Extra confidence if multiple stations contributing
  const stationCount = latestByStation.size;
  if (stationCount >= 3) confidence += 20;
  else if (stationCount >= 2) confidence += 15;
  else confidence += 5;

  // Consistency bonus: if spread trend is smooth (low variance)
  if (trendSeries.length >= 4 && spreadTrend !== null) {
    const predicted = trendSeries.map((p, i) => {
      const dt = (p.time.getTime() - trendSeries[0].time.getTime()) / 3_600_000;
      return trendSeries[0].spread + spreadTrend * dt;
    });
    const residuals = trendSeries.map((p, i) => Math.abs(p.spread - predicted[i]));
    const avgResidual = residuals.reduce((a, b) => a + b, 0) / residuals.length;
    if (avgResidual < 1) confidence += 20;
    else if (avgResidual < 2) confidence += 10;
  }

  confidence = Math.min(100, confidence);

  // Estimate fog ETA
  let fogEta: Date | null = null;
  if (spreadTrend !== null && spreadTrend < -0.1 && currentSpread > 0) {
    const hoursToFog = currentSpread / Math.abs(spreadTrend);
    if (hoursToFog <= 12) {
      fogEta = new Date(now.getTime() + hoursToFog * 3_600_000);
    }
  }

  // Build hypothesis and determine alert level
  const hour = now.getHours();
  const isNight = hour >= 20 || hour < 7;
  const isEvening = hour >= 17 && hour < 20;
  const calmWind = avgWind !== null && avgWind < 2;

  let level: AlertLevel = 'none';
  const notes: string[] = [];

  // Already foggy or about to be
  if (currentSpread <= 1) {
    level = 'critico';
    notes.push(`Spread ${currentSpread.toFixed(1)}°C — niebla muy probable`);
  } else if (currentSpread <= 2.5) {
    level = 'alto';
    notes.push(`Spread ${currentSpread.toFixed(1)}°C — condiciones de niebla`);
  } else if (currentSpread <= 4 && spreadTrend !== null && spreadTrend < -0.3) {
    level = 'riesgo';
    notes.push(`Spread bajando ${spreadTrend.toFixed(1)}°C/h`);
  } else if (fogEta !== null) {
    level = 'riesgo';
    const etaH = (fogEta.getTime() - now.getTime()) / 3_600_000;
    notes.push(`Niebla posible en ~${etaH.toFixed(0)}h`);
  }

  // Amplifiers
  if (calmWind) notes.push('viento en calma');
  if (isNight) notes.push('noche');
  else if (isEvening) notes.push('atardecer');
  if (currentHumidity >= 90) notes.push(`HR ${currentHumidity.toFixed(0)}%`);

  // Downgrade if wind is strong enough to disperse fog (≥3 m/s ≈ 6kt)
  if (avgWind !== null && avgWind >= 3 && level !== 'none') {
    if (level === 'riesgo') level = 'none';
    else if (level === 'alto') level = 'riesgo';
    else if (level === 'critico') level = 'alto';
    notes.push(`viento ${avgWind.toFixed(1)} m/s dispersa`);
  }

  // ── Forecast cross-validation (if available) ────────────
  if (forecast && forecast.length > 0) {
    // Look at the next 6 hours of forecast
    const next6h = forecast.filter((p) => {
      const dt = p.time.getTime() - now.getTime();
      return dt >= 0 && dt <= 6 * 3_600_000;
    });

    if (next6h.length >= 2) {
      // Check if forecast humidity keeps climbing
      const forecastHumidities = next6h
        .map((p) => p.humidity)
        .filter((h): h is number => h !== null);

      if (forecastHumidities.length >= 2) {
        const maxForecastHR = Math.max(...forecastHumidities);
        const forecastHRTrend = forecastHumidities[forecastHumidities.length - 1] - forecastHumidities[0];

        // Forecast agrees: humidity rising above 90%
        // Only promote to riesgo if wind is calm — forecast HR alone is not enough
        if (maxForecastHR >= 95 && forecastHRTrend > 0) {
          confidence = Math.min(100, confidence + 15);
          notes.push('previsión HR↑>95%');
          if (level === 'none' && currentSpread <= 6 && (avgWind === null || avgWind <= 2)) {
            level = 'riesgo';
            notes.push('spread moderado + HR prevista alta + calma');
          }
        } else if (maxForecastHR >= 90) {
          confidence = Math.min(100, confidence + 8);
        }

        // Forecast disagrees: humidity dropping → reduce confidence
        if (forecastHRTrend < -5 && level !== 'none') {
          confidence = Math.max(10, confidence - 15);
          notes.push('previsión HR bajando');
        }
      }

      // Check forecast wind: will it stay calm?
      const forecastWinds = next6h
        .map((p) => p.windSpeed)
        .filter((w): w is number => w !== null);

      if (forecastWinds.length >= 2) {
        const maxForecastWind = Math.max(...forecastWinds);
        if (maxForecastWind > 4 && level !== 'none') {
          confidence = Math.max(10, confidence - 10);
          notes.push(`viento previsto ${maxForecastWind.toFixed(1)} m/s`);
        } else if (maxForecastWind <= 1.5 && level !== 'none') {
          confidence = Math.min(100, confidence + 8);
          notes.push('calma prevista');
        }
      }

      // Cloud cover: clear skies favor fog
      const forecastClouds = next6h
        .map((p) => p.cloudCover)
        .filter((c): c is number => c !== null);
      if (forecastClouds.length >= 2) {
        const avgClouds = forecastClouds.reduce((a, b) => a + b, 0) / forecastClouds.length;
        if (avgClouds <= 20 && isNight) {
          confidence = Math.min(100, confidence + 5);
        } else if (avgClouds > 70 && level !== 'none') {
          confidence = Math.max(10, confidence - 10);
          notes.push('cielo nublado');
        }
      }

      // Visibility cross-validation (Open-Meteo forecast visibility)
      const forecastVisibility = next6h
        .map((p) => p.visibility)
        .filter((v): v is number => v !== null);
      if (forecastVisibility.length >= 2) {
        const minVis = Math.min(...forecastVisibility);
        const avgVis = forecastVisibility.reduce((a, b) => a + b, 0) / forecastVisibility.length;

        if (minVis < 1000) {
          // Forecast predicts fog (visibility <1km)
          confidence = Math.min(100, confidence + 15);
          notes.push(`visibilidad prevista <1km (${(minVis / 1000).toFixed(1)}km)`);
          if (level === 'none' && currentSpread <= 6) {
            level = 'riesgo';
          }
        } else if (minVis < 5000) {
          // Forecast predicts mist/haze
          confidence = Math.min(100, confidence + 8);
          notes.push(`visibilidad prevista reducida (${(minVis / 1000).toFixed(1)}km)`);
        } else if (avgVis > 10000 && level !== 'none') {
          // Forecast: excellent visibility → fog unlikely, suppress
          confidence = Math.max(10, confidence - 15);
          notes.push(`visibilidad prevista buena (>${(avgVis / 1000).toFixed(0)}km)`);
        }
      }

      // Better ETA from forecast: find first hour where forecast HR >= 98%
      if (!fogEta && level === 'none') {
        for (const p of next6h) {
          if (p.humidity !== null && p.humidity >= 98 && (p.windSpeed ?? 5) < 2) {
            fogEta = p.time;
            level = 'riesgo';
            notes.push(`previsión HR ${p.humidity}% a las ${p.time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`);
            break;
          }
        }
      }
    }
  }

  confidence = Math.min(100, Math.max(0, confidence));

  const hypothesis = notes.length > 0
    ? notes.join(' · ')
    : currentSpread > 8
      ? `Spread amplio (${currentSpread.toFixed(1)}°C) — sin riesgo`
      : `Spread ${currentSpread.toFixed(1)}°C — monitorizar`;

  return {
    level,
    dewPoint: currentDewPoint,
    spread: currentSpread,
    spreadTrend,
    fogEta,
    humidity: currentHumidity,
    windSpeed: avgWind,
    confidence,
    hypothesis,
  };
}
