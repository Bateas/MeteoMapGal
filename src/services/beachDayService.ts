/**
 * Beach-day verdict — casual reframe of conditions for the "¿buen día de
 * playa?" question (EJE ALCANCE prototype, S136+3+6).
 *
 * Synthesises data we ALREADY trust into a single sí/regular/no answer for a
 * non-sailor visitor: sun (forecast cloud cover), air temp, wind (live), rain
 * (observed + forecast), and water temp (buoy / MOHID). Galician Atlantic
 * water is cold most of the year, so water temp is weighted explicitly — a
 * 28°C sunny day with 14°C water is still a "feet-only" beach day.
 *
 * Pure computation, no fetches. Deliberately a coarse heuristic — it answers a
 * casual question, not a forecast. Honest about missing data (returns
 * 'unknown' rather than guessing).
 */

export type BeachVerdict = 'great' | 'ok' | 'poor' | 'unknown';

export interface BeachDayInputs {
  /** Forecast cloud cover for the relevant hour, 0-100 (%) */
  cloudCoverPct: number | null;
  /** Live wind speed (kt) */
  windKt: number | null;
  /** Air temperature (°C) */
  airTempC: number | null;
  /** Sea-surface temperature (°C) */
  waterTempC: number | null;
  /** Rain observed at a nearby station right now */
  rainingNow: boolean;
  /** Rain expected within the next few hours */
  rainSoon: boolean;
}

export interface BeachDayResult {
  verdict: BeachVerdict;
  /** 0-100 comfort score (debug / sorting) */
  score: number;
  /** Short casual headline, e.g. "Buen día de playa" */
  summary: string;
  /** 2-4 short chips, e.g. ["Sol pleno", "Agua fría 15°"] */
  reasons: string[];
}

/**
 * Assess how good a day it is for the beach for a casual visitor.
 * Needs at least cloud-cover OR air-temp plus one more signal to commit to a
 * verdict; otherwise returns 'unknown'.
 */
export function assessBeachDay(i: BeachDayInputs): BeachDayResult {
  const known = [i.cloudCoverPct, i.windKt, i.airTempC, i.waterTempC].filter((v) => v != null).length;
  if (known < 2) {
    return { verdict: 'unknown', score: 0, summary: 'Datos insuficientes', reasons: [] };
  }

  // Raining now is an immediate "no" — no scoring needed.
  if (i.rainingNow) {
    return {
      verdict: 'poor',
      score: 0,
      summary: 'Mal día de playa — lloviendo',
      reasons: ['Lloviendo ahora'],
    };
  }

  const reasons: string[] = [];
  let score = 0;

  // ── Sun (0-30) ─────────────────────────────────────────
  if (i.cloudCoverPct != null) {
    const c = i.cloudCoverPct;
    if (c < 20) { score += 30; reasons.push('Sol pleno'); }
    else if (c < 40) { score += 24; reasons.push('Mayormente soleado'); }
    else if (c < 60) { score += 15; reasons.push('Sol y nubes'); }
    else if (c < 85) { score += 6; reasons.push('Muy nublado'); }
    else { reasons.push('Cubierto'); }
  }

  // ── Air temp (0-28) ────────────────────────────────────
  if (i.airTempC != null) {
    const t = i.airTempC;
    if (t >= 26) { score += 28; reasons.push('Calor'); }
    else if (t >= 22) { score += 24; reasons.push(`Buena temperatura ${Math.round(t)}°`); }
    else if (t >= 19) { score += 14; reasons.push(`Templado ${Math.round(t)}°`); }
    else if (t >= 16) { score += 5; reasons.push(`Fresco ${Math.round(t)}°`); }
    else { reasons.push(`Frío ${Math.round(t)}°`); }
  }

  // ── Wind (0-22, penalty when strong) ───────────────────
  if (i.windKt != null) {
    const w = i.windKt;
    if (w < 8) { score += 22; reasons.push('Sin apenas viento'); }
    else if (w < 14) { score += 14; reasons.push('Brisa suave'); }
    else if (w < 20) { score += 5; reasons.push('Algo de viento'); }
    else { score -= 5; reasons.push('Ventoso — arena volando'); }
  }

  // ── Water temp (0-20) — Galician Atlantic is cold ──────
  if (i.waterTempC != null) {
    const wt = i.waterTempC;
    if (wt >= 20) { score += 20; reasons.push(`Agua agradable ${Math.round(wt)}°`); }
    else if (wt >= 18) { score += 14; reasons.push(`Agua fresca ${Math.round(wt)}°`); }
    else if (wt >= 15) { score += 7; reasons.push(`Agua fría ${Math.round(wt)}°`); }
    else { score += 2; reasons.push(`Agua muy fría ${Math.round(wt)}°`); }
  }

  score = Math.max(0, Math.min(100, score));

  let verdict: BeachVerdict = score >= 70 ? 'great' : score >= 45 ? 'ok' : 'poor';

  // Rain soon never lets it be a clean "great", and the caveat must survive
  // the chip trim — reserve the last slot for it rather than letting positive
  // reasons crowd it out.
  const finalReasons = reasons.slice(0, i.rainSoon ? 3 : 4);
  if (i.rainSoon) {
    if (verdict === 'great') verdict = 'ok';
    finalReasons.push('Posible lluvia');
  }

  const summary =
    verdict === 'great' ? 'Buen día de playa'
    : verdict === 'ok' ? 'Día de playa regular'
    : 'Mal día de playa';

  return { verdict, score, summary, reasons: finalReasons };
}
