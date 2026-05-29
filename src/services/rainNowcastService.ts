/**
 * Rain nowcast — "¿llueve ahora? / ¿lluvia próxima?" per spot.
 *
 * Built ONLY on data the user trusts (S136+3+6 reliability audit):
 *  - "Raining NOW" → nearby station precipitation (real observation, high
 *    confidence). NOT the webcam-AI precipitation flag (unreliable for this).
 *  - "Rain SOON" → the spot's own forecast (medium confidence, short horizon).
 *
 * Pure computation — no new API calls. Honest about source/confidence: the
 * caller surfaces "lloviendo (estación X)" for the observed case and
 * "lluvia prevista ~Xh" for the forecast case, never blurring the two.
 */

import type { NormalizedStation, NormalizedReading } from '../types/station';
import type { HourlyForecast } from '../types/forecast';
import { fastDistanceKm } from './idwInterpolation';

// ── Types ────────────────────────────────────────────────

export type RainStatus = 'raining' | 'rain-soon' | 'dry' | 'unknown';

export interface RainNowcast {
  status: RainStatus;
  /** Observed rain at a nearby station right now */
  rainingNow: boolean;
  /** Precipitation (mm) at the wettest nearby station, when raining */
  intensityMm: number | null;
  /** Coarse intensity label (Spanish) when raining */
  intensityLabel: string | null;
  /** Hours until the first forecast rain (null if none in window) */
  nextRainHours: number | null;
  /** Probability (%) of that forecast rain */
  nextRainProb: number | null;
  /** Name of the nearby station reporting rain (for honest attribution) */
  stationName: string | null;
  /** Spanish one-line summary */
  summary: string;
}

// ── Thresholds ───────────────────────────────────────────

/** Min precipitation (mm) in a reading to count as "raining" (above sensor noise) */
const RAIN_THRESHOLD_MM = 0.2;
/** Max reading age (ms) for the observation to be trusted */
const MAX_READING_AGE_MS = 60 * 60 * 1000;
/** Forecast look-ahead window for "rain soon" (hours) */
const FORECAST_WINDOW_H = 6;
/** A forecast hour counts as rain when precip + probability clear these */
const FCST_PRECIP_MM = 0.5;
const FCST_PROB_PCT = 50;
/** "rain-soon" status only if the forecast rain is within this horizon (h) */
const SOON_HORIZON_H = 3;

// ── Core ─────────────────────────────────────────────────

export function assessRainNowcast(opts: {
  spotCenter: [number, number]; // [lon, lat]
  radiusKm: number;
  stations: NormalizedStation[];
  readings: Map<string, NormalizedReading>;
  forecast: HourlyForecast[];
  now?: Date;
}): RainNowcast {
  const { spotCenter, radiusKm, stations, readings, forecast } = opts;
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const [lon, lat] = spotCenter;

  // ── Observed: wettest fresh nearby station ──────────────
  let wettestMm = 0;
  let wettestName: string | null = null;
  let anyStationData = false;

  for (const s of stations) {
    if (fastDistanceKm(lat, lon, s.lat, s.lon) > radiusKm) continue;
    const r = readings.get(s.id);
    if (!r || r.precipitation == null) continue;
    if (nowMs - r.timestamp.getTime() > MAX_READING_AGE_MS) continue;
    anyStationData = true;
    if (r.precipitation > wettestMm) {
      wettestMm = r.precipitation;
      wettestName = s.name;
    }
  }

  const rainingNow = wettestMm >= RAIN_THRESHOLD_MM;

  // ── Forecast: first rain hour in the look-ahead window ──
  let nextRainHours: number | null = null;
  let nextRainProb: number | null = null;
  for (const f of forecast) {
    const dt = f.time.getTime() - nowMs;
    if (dt < 0 || dt > FORECAST_WINDOW_H * 3600_000) continue;
    const precip = f.precipitation ?? 0;
    const prob = f.precipProbability ?? 0;
    if (precip >= FCST_PRECIP_MM && prob >= FCST_PROB_PCT) {
      nextRainHours = Math.round((dt / 3600_000) * 10) / 10;
      nextRainProb = Math.round(prob);
      break;
    }
  }

  // ── Status + summary ────────────────────────────────────
  const intensityLabel = rainingNow ? intensityLabelFor(wettestMm) : null;

  let status: RainStatus;
  let summary: string;

  if (rainingNow) {
    status = 'raining';
    summary = `Lloviendo${intensityLabel ? ` · ${intensityLabel}` : ''}${wettestName ? ` (${wettestName})` : ''}`;
  } else if (nextRainHours != null && nextRainHours <= SOON_HORIZON_H) {
    status = 'rain-soon';
    summary = `Lluvia prevista ~${formatHours(nextRainHours)}${nextRainProb != null ? ` (${nextRainProb}%)` : ''}`;
  } else if (!anyStationData && forecast.length === 0) {
    status = 'unknown';
    summary = 'Sin datos de lluvia';
  } else {
    status = 'dry';
    summary = nextRainHours != null
      ? `Seco · lluvia más tarde (~${formatHours(nextRainHours)})`
      : 'Seco · sin lluvia próxima';
  }

  return {
    status,
    rainingNow,
    intensityMm: rainingNow ? Math.round(wettestMm * 10) / 10 : null,
    intensityLabel,
    nextRainHours,
    nextRainProb,
    stationName: rainingNow ? wettestName : null,
    summary,
  };
}

// ── Helpers ──────────────────────────────────────────────

/** Coarse intensity label from precipitation (mm in the reading interval). */
function intensityLabelFor(mm: number): string {
  if (mm < 0.5) return 'chispea';
  if (mm < 2) return 'lluvia débil';
  if (mm < 6) return 'lluvia';
  return 'lluvia fuerte';
}

/** "1.5h" → "1h30", whole → "2h", sub-hour → "30min". */
function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}min`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins === 0 ? `${whole}h` : `${whole}h${mins}`;
}
