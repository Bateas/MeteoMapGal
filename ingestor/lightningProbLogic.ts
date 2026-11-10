/**
 * Shadow lightning probability: «3 or more strikes within 25 km of the sector point in the next
 * 1 h / 3 h», from three things measured in the last 30 minutes. Pure; the cycle that reads the
 * strikes and stores the result is lightningProbShadow.ts.
 *
 * It is NOT shown anywhere. The coefficients are frozen: they were fitted on every 30-min step
 * of 27-Apr to 10-Nov-2026 and sealed with the rule of their 2027 exam before this file existed
 * (seal «rayos_probabilidad_sombra», 10-Nov-2026). Changing a number here voids that exam: a
 * refit is a new model id and a new seal.
 *
 * Why three variables and not the nine signals of stormPredictor: on the stored season the nine
 * signals, even recalibrated, did worse than these three, and the model CAPE added nothing.
 */
import { haversineDistance } from '../src/services/geoUtils.js';

export const LIGHTNING_PROB_MODEL = 'rayos3-20261110';
export const LIGHTNING_PROB_WINDOW_MIN = 30;
const NEAR_KM = 25;
const REGION_KM = 80;
/** Distance used when there is no strike at all, and the cap for a far one. */
export const NO_STRIKE_KM = 150;

interface Coefs { b0: number; b25: number; b80: number; bd: number }
const COEF_1H: Coefs = { b0: -1.245811, b25: 0.354327, b80: 0.302231, bd: -0.039435 };
const COEF_3H: Coefs = { b0: 0.356192, b25: 0.195571, b80: 0.107854, bd: -0.038857 };

export interface LightningProbInputs {
  /** Strikes within 25 km in the window */
  n25: number;
  /** Strikes within 80 km in the window */
  n80: number;
  /** km to the nearest strike in the window, capped at NO_STRIKE_KM (also the value with none) */
  dmin: number;
}

export interface LightningProb extends LightningProbInputs {
  p1h: number;
  p3h: number;
}

/** The three inputs for one point, from strikes with their time. Strikes outside the window
 *  (older, or stamped in the future) do not count. */
export function lightningProbInputs(
  strikes: readonly { lat: number; lon: number; time: Date | number }[],
  lat: number,
  lon: number,
  nowMs: number,
): LightningProbInputs {
  let n25 = 0;
  let n80 = 0;
  let dmin = NO_STRIKE_KM;
  for (const s of strikes) {
    const t = typeof s.time === 'number' ? s.time : s.time.getTime();
    const age = nowMs - t;
    if (!Number.isFinite(age) || age < 0 || age > LIGHTNING_PROB_WINDOW_MIN * 60_000) continue;
    const km = haversineDistance(lat, lon, s.lat, s.lon);
    if (!Number.isFinite(km)) continue;
    if (km <= NEAR_KM) n25++;
    if (km <= REGION_KM) n80++;
    if (km < dmin) dmin = km;
  }
  return { n25, n80, dmin: Math.round(dmin * 10) / 10 };
}

function logistic(c: Coefs, i: LightningProbInputs): number {
  const z = c.b0 + c.b25 * Math.log(1 + i.n25) + c.b80 * Math.log(1 + i.n80) + c.bd * Math.min(i.dmin, NO_STRIKE_KM);
  return 1 / (1 + Math.exp(-z));
}

export function lightningProb(inputs: LightningProbInputs): LightningProb {
  return { ...inputs, p1h: logistic(COEF_1H, inputs), p3h: logistic(COEF_3H, inputs) };
}

/** One line for the log: the stored figures, readable a year later. */
export function describeLightningProb(sector: string, p: LightningProb): string {
  return `${sector} p1h ${(p.p1h * 100).toFixed(1)} % p3h ${(p.p3h * 100).toFixed(1)} % (25 km: ${p.n25}, 80 km: ${p.n80}, mas cercano: ${p.dmin >= NO_STRIKE_KM ? 'ninguno' : `${p.dmin} km`})`;
}
