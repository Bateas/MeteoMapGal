/**
 * Beach-day verdict — casual reframe of conditions for the "¿buen día de
 * playa?" question (EJE ALCANCE prototype, S136+3+6).
 *
 * Calibrated to GALICIAN reality (user feedback S136+3+7): cold water (17-18°)
 * and a ~22° coast are a NORMAL, perfectly fine beach day here — NOT a bad one.
 * A day is BAD ("mal día") when one of four hard gates trips:
 *   · raining now   · fog / poor visibility   · air < 20°C   · wind ≥ 25 kt
 * Everything else is a SUM: sun, warm air and little wind add, gusts subtract, and a
 * sum under POOR_SCORE is also a bad day (an overcast, gusty front). A windy beach with
 * sun and heat stays a good day. Water temperature is shown for info but NEVER pulls
 * the verdict down (penalising cold water would mark almost every Galician summer day as bad).
 *
 * Pure computation, no fetches. Coarse heuristic — answers a casual question,
 * not a forecast. Honest about missing data (returns 'unknown', not a guess).
 */

import { waterTempLabel } from './buoyUtils';

export type BeachVerdict = 'great' | 'ok' | 'poor' | 'unknown';

export interface BeachDayInputs {
  /** Forecast cloud cover for the relevant hour, 0-100 (%) */
  cloudCoverPct: number | null;
  /** Live wind speed (kt) */
  windKt: number | null;
  /** Live gust (kt), the one the spot shows. Optional: callers without it keep the old behaviour. */
  gustKt?: number | null;
  /** Air temperature (°C) */
  airTempC: number | null;
  /** Sea-surface temperature (°C) */
  waterTempC: number | null;
  /** Rain observed at a nearby station right now */
  rainingNow: boolean;
  /** Rain expected within the next few hours */
  rainSoon: boolean;
  /** Fog / poor visibility (webcam-IA — the one signal it reads reliably) */
  foggy?: boolean;
}

export interface BeachDayResult {
  verdict: BeachVerdict;
  /** 0-100 comfort score (debug / sorting) */
  score: number;
  /** Short casual headline, e.g. "Buen día de playa" */
  summary: string;
  /** 2-4 short chips, e.g. ["Sol", "Buena temperatura 24°"] */
  reasons: string[];
}

/** Air below this (°C) makes it a bad beach day in Galicia. */
const COLD_AIR_GATE = 20;
/** Wind at/above this (kt) is "too windy" for the beach (sand flying). */
const STRONG_WIND_GATE = 25;
/** Gusts SUBTRACT from the sum instead of vetoing the day: some beaches (A Lanzada, Patos) are
 *  windy almost every day and still a good beach day with sun and heat. On 29-sep, with a front
 *  in, Cesantes read 12 kt of mean and 32 of gust under an overcast sky and the spot said
 *  «Día de playa ideal · Brisa suave»; with the penalty and the sky of the current hour that is
 *  a bad day, while a sunny, hot, gusty A Lanzada stays a good one. */
function gustPenalty(gustKt: number): number {
  if (gustKt >= 35) return 35;
  if (gustKt >= 25) return 20;
  if (gustKt >= 18) return 8;
  return 0;
}
/** Below this sum it is a bad beach day even with no hard gate tripped. */
const POOR_SCORE = 20;
/** Score needed to call it an "ideal" (vs merely good) beach day. */
const IDEAL_SCORE = 70;

/**
 * Assess how good a day it is for the beach for a casual visitor in Galicia.
 * Needs at least 2 numeric signals to commit (unless a definitive bad signal
 * like rain/fog is present); otherwise returns 'unknown'.
 */
export function assessBeachDay(i: BeachDayInputs): BeachDayResult {
  // ── Definitive "mal día" signals — valid even with thin data ──
  if (i.rainingNow) return bad('Lloviendo ahora');
  if (i.foggy) return bad('Niebla / poca visibilidad');

  const known = [i.cloudCoverPct, i.windKt, i.airTempC, i.waterTempC].filter((v) => v != null).length;
  if (known < 2) {
    return { verdict: 'unknown', score: 0, summary: 'Datos insuficientes', reasons: [] };
  }

  // ── Remaining hard gates (need the value) ──
  if (i.airTempC != null && i.airTempC < COLD_AIR_GATE) {
    return bad(`Frío ${Math.round(i.airTempC)}° en costa`);
  }
  if (i.windKt != null && i.windKt >= STRONG_WIND_GATE) {
    return bad('Demasiado viento');
  }

  // ── Not a bad day → score ideal vs "buen día" ──
  const reasons: string[] = [];
  let score = 0;

  // Sun (0-35) — biggest driver of an "ideal" day.
  if (i.cloudCoverPct != null) {
    const c = i.cloudCoverPct;
    if (c < 30) { score += 35; reasons.push('Sol'); }
    else if (c < 60) { score += 20; reasons.push('Sol y nubes'); }
    else if (c < 85) { score += 8; reasons.push('Nublado'); }
    else { reasons.push('Cubierto'); }
  }

  // Air warmth above the 20° floor (0-30).
  if (i.airTempC != null) {
    const t = i.airTempC;
    if (t >= 26) { score += 30; reasons.push(`Calor ${Math.round(t)}°`); }
    else if (t >= 22) { score += 22; reasons.push(`Buena temperatura ${Math.round(t)}°`); }
    else { score += 12; reasons.push(`Agradable ${Math.round(t)}°`); } // 20-22
  }

  // Wind comfort under the strong-wind gate (0-20), minus the gusts (0-35). When the gusts
  // count, they are the chip: «Brisa suave» next to 32 kt gusts is what went wrong on 29-sep.
  const penalty = i.gustKt != null ? gustPenalty(i.gustKt) : 0;
  if (i.windKt != null) {
    const w = i.windKt;
    if (w < 10) score += 20;
    else if (w < 16) score += 12;
    else score += 5; // 16-25
    // Wording by Beaufort, not by the comfort score above: under 7 kt (force 0-2) there is
    // hardly any wind on a beach; 7-10 (force 3) is a breeze you feel and that lifts fine sand.
    // On 30-sep Cesantes read «Sin apenas viento» with 9 kt.
    if (penalty === 0) reasons.push(w < 7 ? 'Sin apenas viento' : w < 16 ? 'Brisa suave' : 'Algo de viento');
  }
  if (penalty > 0) {
    score -= penalty;
    reasons.push(`Rachas de ${Math.round(i.gustKt as number)} kt`);
  }

  // Water — INFO only, small bonus, never a penalty (cold water is normal here).
  // Vocabulary + thresholds shared via waterTempLabel (buoyUtils).
  if (i.waterTempC != null) {
    const wt = i.waterTempC;
    const label = waterTempLabel(wt);
    score += label === 'agradable' ? 8 : label === 'fresca' ? 4 : 1;
    reasons.push(`Agua ${label} ${Math.round(wt)}°`);
  }

  score = Math.max(0, Math.min(100, score));
  let verdict: BeachVerdict = score >= IDEAL_SCORE ? 'great' : score < POOR_SCORE ? 'poor' : 'ok';

  // Rain soon doesn't make it a bad day (you can still go now), but it's not
  // "ideal" and earns a caveat chip — reserve a slot so it survives the trim.
  const finalReasons = reasons.slice(0, i.rainSoon ? 3 : 4);
  if (i.rainSoon) {
    if (verdict === 'great') verdict = 'ok';
    finalReasons.push('Posible lluvia');
  }

  const summary = verdict === 'great' ? 'Día de playa ideal' : verdict === 'poor' ? 'Mal día de playa' : 'Buen día de playa';
  return { verdict, score, summary, reasons: finalReasons };
}

/** Build a "mal día" result with a single leading reason. */
function bad(reason: string): BeachDayResult {
  return { verdict: 'poor', score: 0, summary: 'Mal día de playa', reasons: [reason] };
}
