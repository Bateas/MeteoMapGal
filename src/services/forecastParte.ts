/**
 * The forecast as a «parte»: one sentence per day and the daylight hours, in the words the map
 * uses for a spot (spotScoringEngine windVerdict, interior spots): calma < 6 kt, flojo 6-8,
 * navegable 8-12, bueno 12-18, fuerte 18 or more. The colour of each hour is the app's one wind scale
 * (windUtils.windTone), which goes on past «fuerte»: duro 22, temporal 34, tduro 48. Pure: no
 * stores, no fetches.
 *
 * Everything here is MODEL wind at one point, not corrected with what the stations measure; the
 * panel says so under the strips.
 */
import { degreesToCardinal } from './windUtils';
import type { HourlyForecast } from '../types/forecast';
import { msToKnots, windTone as windToneIndex, WIND_TONE_NAMES, type WindToneName } from './windUtils';
import { isDaylight } from './solarUtils';

export type Tone = WindToneName;
export const TONES: readonly Tone[] = WIND_TONE_NAMES;

/** The app's wind scale by name: the class `t-<tone>` and the tokens `--g-*-<tone>`. */
export function windTone(kt: number): Tone {
  return WIND_TONE_NAMES[windToneIndex(kt)];
}

/** «Fuerte» or more: 18 kt and up, whatever colour the wind has past it. */
const isStrongTone = (t: Tone) => TONES.indexOf(t) >= TONES.indexOf('fuerte');

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

/** Every stretch of consecutive hours that pass `ok`, in time order. */
function runsOf(hours: PartHour[], ok: (h: PartHour) => boolean): PartHour[][] {
  const runs: PartHour[][] = [];
  for (const h of hours) {
    if (!ok(h)) continue;
    const last = runs[runs.length - 1];
    if (last && h.time.getTime() - last[last.length - 1].time.getTime() <= 3_600_000) last.push(h);
    else runs.push([h]);
  }
  return runs;
}

/** «A», «A y B», «A, B y C». */
const listEs = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

const span = (run: PartHour[]) => `de ${hh(run[0].time)} a ${hh(run[run.length - 1].time) + 1} h`;
const peak = (run: PartHour[]) => run.reduce((a, b) => (b.kt > a.kt ? b : a));

/**
 * One sentence for the daylight hours of a day: the answer, not a list. Strong wind first, every
 * stretch of it (safety); then the best sailing stretch (the one with the strongest sailable hour)
 * and how many other sailable hours there are. The strip under it shows each hour, so the sentence
 * never enumerates them (18-nov: «navegable de 8 a 9, de 10 a 13 y de 14 a 18 h, bueno de 11 a 12,
 * de 14 a 15 y de 17 a 18 h» answered nothing). It never calls the rest calm: on 17-nov «el resto,
 * flojo» hid 15 kt in the afternoon.
 */
export function daySentence(hours: PartHour[]): string {
  if (hours.length === 0) return 'Sin horas de luz por delante.';
  const parts: string[] = [];
  const strongRuns = runsOf(hours, (h) => isStrongTone(h.tone));
  const strong = strongRuns.flat();
  if (strong.length) {
    const gust = Math.max(...strong.map((h) => h.gustKt ?? h.kt));
    parts.push(`Fuerte ${listEs(strongRuns.map(span))} (rachas de ${Math.round(gust)} kt)`);
  }
  const runs = runsOf(hours, (h) => sailable(h.tone));
  if (runs.length) {
    // The stretch holding the strongest sailable hour; on a tie the longer one, then the earlier.
    const best = runs.reduce((a, b) => {
      const ka = Math.round(peak(a).kt), kb = Math.round(peak(b).kt);
      return kb > ka || (kb === ka && b.length > a.length) ? b : a;
    });
    const p = peak(best);
    const from = p.dirDeg != null ? ` del ${degreesToCardinal(p.dirDeg)}` : '';
    const word = runs.length > 1 ? 'Mejor' : best.every((h) => h.tone === 'bueno') ? 'Bueno' : 'Navegable';
    const head = `${word} ${span(best)}, hasta ${Math.round(p.kt)} kt${from}`;
    parts.push(parts.length ? head.charAt(0).toLowerCase() + head.slice(1) : head);
    const others = runs.filter((r) => r !== best).flat().length;
    if (others) parts.push(`navegable ${others === 1 ? 'otra hora' : `otras ${others} h`}`);
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
