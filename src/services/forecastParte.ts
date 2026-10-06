/**
 * The forecast as a «parte»: one sentence per day and the daylight hours, in the words the map
 * uses for a spot (spotScoringEngine windVerdict, interior spots): calma < 6 kt, flojo 6-8,
 * navegable 8-12, bueno 12-18, fuerte 18 or more. Pure: no stores, no fetches.
 *
 * Everything here is MODEL wind at one point, not corrected with what the stations measure; the
 * panel says so under the strips.
 */
import type { HourlyForecast } from '../types/forecast';
import { msToKnots } from './windUtils';
import { isDaylight } from './solarUtils';

export type Tone = 'calma' | 'flojo' | 'navegable' | 'bueno' | 'fuerte';
export const TONES: Tone[] = ['calma', 'flojo', 'navegable', 'bueno', 'fuerte'];

export function windTone(kt: number): Tone {
  const k = Math.round(kt);
  if (k < 6) return 'calma';
  if (k < 8) return 'flojo';
  if (k < 12) return 'navegable';
  if (k < 18) return 'bueno';
  return 'fuerte';
}

const CARDINAL = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
/** Where the wind comes from, in Spanish (16 points). */
export function cardinalEs(deg: number): string {
  return CARDINAL[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export interface PartHour {
  time: Date;
  kt: number;
  gustKt: number | null;
  dirDeg: number | null;
  tone: Tone;
  rainMm: number;
  rainProb: number | null;
  temp: number | null;
}

export interface DayPart {
  key: string;
  label: string;
  hours: PartHour[];
  sentence: string;
}

/** Rain worth naming in an hour: a measurable amount the model gives at least even odds. */
const RAIN_MM = 0.3;
const RAIN_PROB = 50;
const isRainy = (h: PartHour) => h.rainMm >= RAIN_MM && (h.rainProb ?? 100) >= RAIN_PROB;
const sailable = (t: Tone) => t === 'navegable' || t === 'bueno';
const hh = (d: Date) => d.getHours();

function longestRun(hours: PartHour[], ok: (h: PartHour) => boolean): PartHour[] {
  let best: PartHour[] = [], cur: PartHour[] = [];
  for (const h of hours) {
    if (ok(h) && (cur.length === 0 || h.time.getTime() - cur[cur.length - 1].time.getTime() <= 3_600_000)) cur.push(h);
    else cur = ok(h) ? [h] : [];
    if (cur.length > best.length) best = [...cur];
  }
  return best;
}

const span = (run: PartHour[]) => `de ${hh(run[0].time)} a ${hh(run[run.length - 1].time) + 1} h`;
const peak = (run: PartHour[]) => run.reduce((a, b) => (b.kt > a.kt ? b : a));

/** One sentence for the daylight hours of a day, from its best window. */
export function daySentence(hours: PartHour[]): string {
  if (hours.length === 0) return 'Sin horas de luz por delante.';
  const parts: string[] = [];
  const strong = longestRun(hours, (h) => h.tone === 'fuerte');
  if (strong.length) {
    const gust = Math.max(...strong.map((h) => h.gustKt ?? h.kt));
    parts.push(`Fuerte ${span(strong)} (rachas de ${Math.round(gust)} kt)`);
  }
  const run = longestRun(hours, (h) => sailable(h.tone));
  if (run.length) {
    const p = peak(run);
    const from = p.dirDeg != null ? ` del ${cardinalEs(p.dirDeg)}` : '';
    const good = longestRun(run, (h) => h.tone === 'bueno');
    const head = good.length && good.length < run.length
      ? `Navegable ${span(run)}, bueno ${span(good)}`
      : `${good.length ? 'Bueno' : 'Navegable'} ${span(run)}`;
    parts.push(`${parts.length ? head.charAt(0).toLowerCase() + head.slice(1) : head} (hasta ${Math.round(p.kt)} kt${from})`);
    const rest = hours.filter((h) => !run.includes(h) && !strong.includes(h));
    if (rest.length) parts.push(rest.some((h) => h.tone === 'flojo') ? 'el resto, flojo o en calma' : 'el resto, en calma');
  } else if (!strong.length) {
    const p = peak(hours);
    return `Sin viento para navegar: como mucho ${Math.round(p.kt)} kt hacia las ${hh(p.time)} h.${rainNote(hours)}`;
  }
  return `${parts.join('; ')}.${rainNote(hours)}`;
}

function rainNote(hours: PartHour[]): string {
  const wet = hours.filter(isRainy);
  if (!wet.length) return '';
  return wet.length >= hours.length / 2 ? ' Lluvia buena parte del día.' : ` Lluvia hacia las ${hh(wet[0].time)} h.`;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(d: Date, now: Date): string {
  const k = dayKey(d);
  if (k === dayKey(now)) return 'Hoy';
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (k === dayKey(tomorrow)) return 'Mañana';
  const name = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * The next `days` days from `now`: daylight hours still to come (today from the current hour),
 * with their tone and one sentence each. Days with no daylight hours left are skipped.
 * An hour counts as daylight when its middle falls between sunrise and sunset: the models flag
 * almost every hour as day (the 6-oct panel listed 0 h and 1 h).
 */
const middleIsDaylight = (t: Date) => isDaylight(new Date(t.getTime() + 30 * 60_000));

function toPartHour(p: HourlyForecast & { windSpeed: number }): PartHour {
  const kt = msToKnots(p.windSpeed);
  return {
    time: p.time, kt,
    gustKt: p.windGusts != null ? msToKnots(p.windGusts) : null,
    dirDeg: p.windDirection ?? null,
    tone: windTone(kt),
    rainMm: p.precipitation ?? 0,
    rainProb: p.precipProbability ?? null,
    temp: p.temperature ?? null,
  };
}

const hasWind = (p: HourlyForecast): p is HourlyForecast & { windSpeed: number } => p.windSpeed != null;

export function buildDayParts(hourly: HourlyForecast[], now: Date, days = 3, isLight: (t: Date) => boolean = middleIsDaylight): DayPart[] {
  const from = new Date(now); from.setMinutes(0, 0, 0);
  const out = new Map<string, DayPart>();
  for (const p of hourly) {
    if (p.time < from || !isLight(p.time) || !hasWind(p)) continue;
    const key = dayKey(p.time);
    if (!out.has(key)) {
      if (out.size >= days) break;
      out.set(key, { key, label: dayLabel(p.time, now), hours: [], sentence: '' });
    }
    out.get(key)!.hours.push(toPartHour(p));
  }
  for (const d of out.values()) d.sentence = daySentence(d.hours);
  return [...out.values()];
}

/** One column of the hour-by-hour table: night hours included, flagged so the table can dim them. */
export interface HourCol extends PartHour {
  light: boolean;
  dayKey: string;
  dayLabel: string;
  humidity: number | null;
  pressure: number | null;
  skyState: string | null;
  cloudCover: number | null;
}

/** Every forecast hour from the current one for `hours` hours, day and night. */
export function buildHourCols(hourly: HourlyForecast[], now: Date, hours = 48, isLight: (t: Date) => boolean = middleIsDaylight): HourCol[] {
  const from = new Date(now); from.setMinutes(0, 0, 0);
  const to = from.getTime() + hours * 3_600_000;
  return hourly
    .filter((p): p is HourlyForecast & { windSpeed: number } => p.time >= from && p.time.getTime() < to && hasWind(p))
    .map((p) => ({
      ...toPartHour(p),
      light: isLight(p.time),
      dayKey: dayKey(p.time),
      dayLabel: dayLabel(p.time, now),
      humidity: p.humidity ?? null,
      pressure: p.pressure ?? null,
      skyState: p.skyState ?? null,
      cloudCover: p.cloudCover ?? null,
    }));
}

/**
 * Temperature band for the hour table, on the app's own breakpoints (windUtils.temperatureColor:
 * 5, 10, 25, 30, 35 °C) but blue for cold and orange/red for heat only: green and yellow already
 * mean «navegable» and «bueno» in the wind row. 10-25 °C stays plain ink.
 */
export type TempBand = 'frio2' | 'frio' | 'templado' | 'calido' | 'calor' | 'extremo';
export function tempBand(t: number): TempBand {
  if (t < 5) return 'frio2';
  if (t < 10) return 'frio';
  if (t < 25) return 'templado';
  if (t < 30) return 'calido';
  if (t < 35) return 'calor';
  return 'extremo';
}
