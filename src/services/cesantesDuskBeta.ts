/**
 * BETA «Cesantes al anochecer» — a hypothesis in its exam, NOT the map's figure.
 *
 * After the sun is cut, on a SW breeze afternoon, the water of Cesantes keeps blowing like Porto de
 * Vigo (1.0-1.4 times its reading) while the stations on land, which the engine follows, drop to
 * 1-4 kt: the app says 3-5 with 8-10 on the water. Rule (lab note of 13-oct, fixed
 * before the out-of-sample evenings, 3 of 3 by 15-oct): after 16 h local, interior sun below the
 * whole-boost value, Porto de Vigo from 200-290°, an afternoon that WAS sunny, and no north wind
 * aloft (850 hPa from 300-30° at 10 kt or more: the 25-sep evening, when the breeze died with Porto de
 * Vigo still at 9 SW) → Cesantes = max(app, 1.0 × Porto de Vigo). Factor 1.0 on purpose: short
 * rather than invented.
 *
 * Shared by the server (a Telegram line for the owner only) and, later, the observers' popup. Any
 * missing input means «no BETA»: it never guesses.
 */
import { clearSkyGhi, solarElevationDeg } from './solarUtils';

export const DUSK_FROM_HOUR = 16;
export const DUSK_TO_HOUR = 23;
/** Interior sun at which the canalization boost is whole (FULL_SOLAR_FOR_THERMAL_BREEZE): below it
 *  the boost is fading, which is when the engine starts to fall short. */
export const DUSK_FULL_SUN_WM2 = 400;
export const DUSK_PV_DIR_MIN = 200;
export const DUSK_PV_DIR_MAX = 290;
/** «The afternoon was sunny»: the interior reached this share of the clear-sky radiation between
 *  12 and 16 h. Provisional (the lab note proposed clearSkyGhi without a figure); a cloudy
 *  afternoon gives 0.3-0.6 times Porto de Vigo, so the BETA must not fire then. */
export const DUSK_SUNNY_AFTERNOON_RATIO = 0.6;
export const DUSK_NORTH_ALOFT_KT = 10;
/** The owner's line is only worth sending when it says something the map does not. */
export const DUSK_MIN_GAIN_KT = 2;

const CESANTES_LAT = 42.307;
const CESANTES_LON = -8.619;

export interface DuskBetaInput {
  nowMs: number;
  /** What the map shows for Cesantes (null while provisional). */
  appKt: number | null;
  /** Porto de Vigo, already checked for freshness. */
  pv: { kt: number; dirDeg: number } | null;
  /** Peak interior sun now (W/m²), computeInteriorSolar. */
  interiorSolar: number | null;
  /** Best share of clear sky the interior reached between 12 and 16 h today. */
  afternoonSunRatio: number | null;
  /** 850 hPa over the Rías. */
  upper850: { dirDeg: number; speedKt: number } | null;
}

export type DuskBeta =
  | { active: true; estimateKt: number; gainKt: number }
  | { active: false; reason: string };

export function madridHour(ms: number): number {
  const p = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date(ms));
  const h = Number(p.find((x) => x.type === 'hour')?.value);
  const m = Number(p.find((x) => x.type === 'minute')?.value);
  return h + m / 60;
}

export function madridDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(ms));
}

function northAloft(u: { dirDeg: number; speedKt: number }): boolean {
  const d = ((u.dirDeg % 360) + 360) % 360;
  return (d >= 300 || d <= 30) && u.speedKt >= DUSK_NORTH_ALOFT_KT;
}

export function assessCesantesDusk(i: DuskBetaInput): DuskBeta {
  const h = madridHour(i.nowMs);
  if (h < DUSK_FROM_HOUR || h >= DUSK_TO_HOUR) return { active: false, reason: 'fuera de hora' };
  if (i.pv == null) return { active: false, reason: 'sin Porto de Vigo' };
  const d = ((i.pv.dirDeg % 360) + 360) % 360;
  if (d < DUSK_PV_DIR_MIN || d > DUSK_PV_DIR_MAX) return { active: false, reason: 'Porto de Vigo no es W-SW' };
  if (i.interiorSolar == null) return { active: false, reason: 'sin sol del interior' };
  if (i.interiorSolar >= DUSK_FULL_SUN_WM2) return { active: false, reason: 'aún hay sol' };
  if (i.afternoonSunRatio == null) return { active: false, reason: 'sin dato de la tarde' };
  if (i.afternoonSunRatio < DUSK_SUNNY_AFTERNOON_RATIO) return { active: false, reason: 'tarde nublada' };
  if (i.upper850 == null) return { active: false, reason: 'sin dato de altura' };
  if (northAloft(i.upper850)) return { active: false, reason: 'norte en altura' };
  const app = i.appKt ?? 0;
  const estimateKt = Math.round(Math.max(app, i.pv.kt) * 10) / 10;
  return { active: true, estimateKt, gainKt: Math.round((estimateKt - app) * 10) / 10 };
}

/** The «sunny afternoon» memory: best interior/clear-sky share between 12 and 16 h, per local day. */
export interface AfternoonSun { date: string; max: number | null }

export function noteAfternoonSun(state: AfternoonSun, nowMs: number, interiorSolar: number | null): AfternoonSun {
  const date = madridDate(nowMs);
  const s = state.date === date ? state : { date, max: null };
  const h = madridHour(nowMs);
  if (interiorSolar == null || h < 12 || h >= 16) return s;
  const elev = solarElevationDeg(nowMs, CESANTES_LAT, CESANTES_LON);
  if (elev < 10) return s;
  const ratio = interiorSolar / clearSkyGhi(elev);
  return { date, max: s.max == null ? ratio : Math.max(s.max, ratio) };
}
