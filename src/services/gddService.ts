/**
 * Growing Degree Days (GDD) service for viticulture.
 *
 * GDD measures heat accumulation during the growing season.
 * Formula: GDD_daily = max(0, (Tmax + Tmin) / 2 - Tbase)
 *
 * Tbase = 10°C for Vitis vinifera (standard grapevine base temperature).
 *
 * Growth stages are calibrated for Galician viticulture (Ribeiro, Ribeira Sacra,
 * Rías Baixas DO regions) — slightly cooler than continental Spain.
 *
 * Data source: Open-Meteo daily forecast + past_days for season accumulation.
 * No API key required.
 */

import type { HourlyForecast } from '../types/forecast';
import { openMeteoFetch } from '../api/openMeteoQueue';

// ── Constants ────────────────────────────────────────────

const TBASE = 10; // °C — Vitis vinifera base temperature

/** Growing season start: March 1 for Galician climate. */
const SEASON_START_MONTH = 2; // 0-indexed (2 = March)
const SEASON_START_DAY = 1;

/** Cache key prefix and TTL (1h — GDD only changes daily) */
const GDD_CACHE_PREFIX = 'gdd_';
const GDD_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Types ────────────────────────────────────────────────

export interface GDDResult {
  /** Accumulated GDD from season start to today (°C·days) */
  accumulated: number | null;
  /** Today's GDD contribution (°C·days) */
  todayGDD: number | null;
  /** Current phenological growth stage (Spanish) */
  growthStage: string;
  /** Growth stage progress within current phase (0-100%) */
  stageProgress: number;
  /** Base temperature used (°C) */
  baseTemp: number;
  /** Season start date */
  seasonStart: Date;
  /** Days since season start */
  daysSinceStart: number;
  /** Spanish crop management advice */
  advice: string;
  /** Next phenological milestone */
  nextMilestone: { name: string; gddNeeded: number } | null;
}

/** Grapevine growth stages calibrated for Galicia (cooler climate). */
const GROWTH_STAGES = [
  { name: 'Latencia',             gddMin: 0,    gddMax: 50,   advice: 'Poda invernal. Revisar estructura de espalderas.' },
  { name: 'Hinchazón de yemas',   gddMin: 50,   gddMax: 100,  advice: 'Fin de poda. Aplicar tratamiento preventivo de cobre.' },
  { name: 'Desborre',             gddMin: 100,  gddMax: 200,  advice: 'Riesgo de heladas tardías. Vigilar temperaturas nocturnas.' },
  { name: 'Brotes en desarrollo', gddMin: 200,  gddMax: 400,  advice: 'Desbrote y atado de pámpanos. Primer tratamiento anti-mildiu.' },
  { name: 'Floración',            gddMin: 400,  gddMax: 600,  advice: 'Fase crítica. No tratar durante floración. Evitar estrés hídrico.' },
  { name: 'Cuajado',              gddMin: 600,  gddMax: 850,  advice: 'Aclareo de racimos si producción excesiva. Tratamientos anti-oídio.' },
  { name: 'Envero',               gddMin: 850,  gddMax: 1200, advice: 'Deshojado zona de racimos. Reducir riego para concentrar sabores.' },
  { name: 'Maduración',           gddMin: 1200, gddMax: 1600, advice: 'Controlar grado, acidez y estado sanitario. Preparar vendimia.' },
  { name: 'Vendimia',             gddMin: 1600, gddMax: 2000, advice: 'Recoger según madurez fenólica. Priorizar parcelas tempranas.' },
] as const;

// ── Session cache ────────────────────────────────────────

function getCachedGDD(key: string): { accumulated: number; days: number } | null {
  try {
    const raw = sessionStorage.getItem(GDD_CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; accumulated: number; days: number };
    if (Date.now() - parsed.ts > GDD_CACHE_TTL_MS) {
      sessionStorage.removeItem(GDD_CACHE_PREFIX + key);
      return null;
    }
    return { accumulated: parsed.accumulated, days: parsed.days };
  } catch {
    return null;
  }
}

function setCachedGDD(key: string, accumulated: number, days: number): void {
  try {
    sessionStorage.setItem(
      GDD_CACHE_PREFIX + key,
      JSON.stringify({ ts: Date.now(), accumulated, days }),
    );
  } catch { /* sessionStorage full */ }
}

// ── Core calculations ────────────────────────────────────

/**
 * Calculate GDD for a single day.
 * @returns GDD contribution (°C·days), always ≥ 0
 */
export function dailyGDD(tMax: number, tMin: number, tBase = TBASE): number {
  const tAvg = (tMax + tMin) / 2;
  return Math.max(0, tAvg - tBase);
}

/**
 * Get the growing season start date for the current year.
 * If we're before March 1, there's no active season — return null.
 */
export function getSeasonStart(): Date | null {
  const now = new Date();
  const year = now.getFullYear();

  // Season start: March 1 of current year
  const start = new Date(year, SEASON_START_MONTH, SEASON_START_DAY);

  // If we're before the season start, no active season
  if (now < start) return null;

  return start;
}

/**
 * Fetch accumulated GDD from Open-Meteo for the current growing season.
 * Uses the forecast API with `past_days` to get daily Tmax/Tmin.
 * Cached for 1 hour (GDD only changes once per day).
 */
export async function fetchSeasonGDD(
  lat: number,
  lon: number,
): Promise<{ accumulated: number; days: number } | null> {
  const seasonStart = getSeasonStart();
  if (!seasonStart) return null;

  const cacheKey = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
  const cached = getCachedGDD(cacheKey);
  if (cached) return cached;

  // Calculate days since season start
  const now = new Date();
  const diffMs = now.getTime() - seasonStart.getTime();
  const pastDays = Math.min(Math.ceil(diffMs / (24 * 60 * 60 * 1000)), 92); // max 92 days

  if (pastDays < 1) return { accumulated: 0, days: 0 };

  // Open-Meteo forecast API with past_days for daily Tmax/Tmin
  const startDate = seasonStart.toISOString().slice(0, 10);
  const endDate = now.toISOString().slice(0, 10);

  const url = `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&timezone=Europe%2FMadrid`;

  try {
    const res = await openMeteoFetch(url, undefined, 15_000);
    if (!res.ok) {
      console.warn(`[GDD] Archive API failed: ${res.status}`);
      return null;
    }

    const data = await res.json() as {
      daily?: {
        time: string[];
        temperature_2m_max: (number | null)[];
        temperature_2m_min: (number | null)[];
      };
    };

    if (!data.daily || data.daily.time.length === 0) return null;

    let accumulated = 0;
    let validDays = 0;

    for (let i = 0; i < data.daily.time.length; i++) {
      const tMax = data.daily.temperature_2m_max[i];
      const tMin = data.daily.temperature_2m_min[i];
      if (tMax !== null && tMin !== null) {
        accumulated += dailyGDD(tMax, tMin);
        validDays++;
      }
    }

    accumulated = Math.round(accumulated * 10) / 10;

    setCachedGDD(cacheKey, accumulated, validDays);
    return { accumulated, days: validDays };
  } catch (err) {
    console.warn('[GDD] Fetch failed:', err);
    return null;
  }
}

/**
 * Calculate today's GDD contribution from forecast data (no API call needed).
 * Uses the same HourlyForecast[] already available in the field alert engine.
 */
export function computeTodayGDD(forecast: HourlyForecast[]): number | null {
  if (forecast.length < 8) return null;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  // Filter to today's forecast hours
  const todayHours = forecast.filter((p) => {
    const t = p.time.getTime();
    return t >= todayStart.getTime() && t < todayEnd.getTime();
  });

  const temps = todayHours
    .map((p) => p.temperature)
    .filter((t): t is number => t !== null);

  if (temps.length < 4) return null;

  const tMax = Math.max(...temps);
  const tMin = Math.min(...temps);

  return Math.round(dailyGDD(tMax, tMin) * 10) / 10;
}

/**
 * Determine the current phenological growth stage from accumulated GDD.
 */
export function getGrowthStage(accumulatedGDD: number): {
  stage: typeof GROWTH_STAGES[number];
  progress: number;
  nextMilestone: { name: string; gddNeeded: number } | null;
} {
  // Find current stage
  let currentIdx = 0;
  for (let i = GROWTH_STAGES.length - 1; i >= 0; i--) {
    if (accumulatedGDD >= GROWTH_STAGES[i].gddMin) {
      currentIdx = i;
      break;
    }
  }

  const stage = GROWTH_STAGES[currentIdx];
  const range = stage.gddMax - stage.gddMin;
  const inStage = accumulatedGDD - stage.gddMin;
  const progress = Math.min(100, Math.round((inStage / range) * 100));

  // Next milestone
  const nextIdx = currentIdx + 1;
  const nextMilestone = nextIdx < GROWTH_STAGES.length
    ? {
        name: GROWTH_STAGES[nextIdx].name,
        gddNeeded: Math.round(GROWTH_STAGES[nextIdx].gddMin - accumulatedGDD),
      }
    : null;

  return { stage, progress, nextMilestone };
}
