/**
 * What the forecast panel warns about for one day, above its sentence: the official warnings
 * (MeteoGalicia, and IPMA where it reaches the sector) and the forecast storm risk, with the same
 * rule as the 9 h Telegram summary (stormRiskRule). Pure: the caller passes what the stores hold.
 * Silent on most days, which is the point: one line only when there is something.
 */
import type { MGWarning } from '../api/mgWarningsClient';
import type { IpmaWarning } from '../api/ipmaWarningsClient';
import type { HourlyForecast } from '../types/forecast';
import { isStormRiskHour } from './stormRiskRule';

export interface DayNotice {
  /** 1 amarillo, 2 naranja, 3 rojo; 0 = storm risk from the model (not an official warning). */
  level: 0 | 1 | 2 | 3;
  text: string;
}

/** Storm risk is named from the hours the summary also looks at. */
const STORM_FROM_HOUR = 8;
const STORM_TO_HOUR = 21;

const LEVEL = ['', 'amarillo', 'naranja', 'rojo'];

const TYPE_ES: Record<string, string> = {
  // MeteoGalicia (Galician or Spanish)
  vento: 'viento', viento: 'viento', choiva: 'lluvia', chuvia: 'lluvia', lluvia: 'lluvia',
  tormenta: 'tormenta', treboada: 'tormenta', 'tormenta eléctrica': 'tormenta', ondas: 'oleaje', oleaxe: 'oleaje',
  'néboa': 'niebla', niebla: 'niebla', neve: 'nieve', nieve: 'nieve', calor: 'calor', 'frío': 'frío', frio: 'frío',
  // IPMA (Portuguese)
  'agitação marítima': 'oleaje', nevoeiro: 'niebla', 'precipitação': 'lluvia', trovoada: 'tormenta',
  'tempo quente': 'calor', 'tempo frio': 'frío',
};
const typeEs = (t: string) => TYPE_ES[t.trim().toLowerCase()] ?? t.trim().toLowerCase();

function dayBounds(day: Date): [number, number] {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  return [start, start + 86_400_000];
}

/** «de 12 a 20 h», «desde las 15 h», «hasta las 9 h» or «todo el día», clipped to the day. */
function spanText(fromMs: number, toMs: number, [d0, d1]: [number, number]): string {
  const startsBefore = fromMs <= d0;
  const endsAfter = toMs >= d1;
  const h = (ms: number) => new Date(ms).getHours();
  if (startsBefore && endsAfter) return 'todo el día';
  if (startsBefore) return `hasta las ${h(toMs)} h`;
  if (endsAfter) return `desde las ${h(fromMs)} h`;
  return `de ${h(fromMs)} a ${h(toMs)} h`;
}

interface Span { level: number; from: number; to: number }

function merge(into: Map<string, Span>, key: string, level: number, from: number, to: number) {
  const s = into.get(key);
  if (!s) into.set(key, { level, from, to });
  else { s.level = Math.max(s.level, level); s.from = Math.min(s.from, from); s.to = Math.max(s.to, to); }
}

export function officialNotices(day: Date, mg: MGWarning[], ipma: IpmaWarning[]): DayNotice[] {
  const bounds = dayBounds(day);
  const [d0, d1] = bounds;
  const spans = new Map<string, Span>();
  for (const w of mg) {
    for (const z of w.zones) {
      const from = z.startTime.getTime(), to = z.endTime.getTime();
      if (to > d0 && from < d1 && z.level >= 1) merge(spans, `MeteoGalicia|${typeEs(w.type)}`, z.level, from, to);
    }
  }
  for (const w of ipma) {
    const from = w.startTime.getTime(), to = w.endTime.getTime();
    if (to > d0 && from < d1 && w.level >= 1) merge(spans, `IPMA|${typeEs(w.type)}`, w.level, from, to);
  }
  return [...spans.entries()]
    .map(([key, s]) => {
      const [source, type] = key.split('|');
      return { level: Math.min(3, s.level) as 1 | 2 | 3, text: `Aviso ${LEVEL[Math.min(3, s.level)]} de ${source} por ${type}, ${spanText(s.from, s.to, bounds)}` };
    })
    .sort((a, b) => b.level - a.level);
}

/** First hour of the day (from `fromHour`) the model gives uncapped instability, or null. */
export function stormNotice(day: Date, convection: HourlyForecast[], fromHour = STORM_FROM_HOUR): DayNotice | null {
  const [d0, d1] = dayBounds(day);
  for (const f of convection) {
    const t = f.time.getTime();
    if (t < d0 || t >= d1) continue;
    const h = f.time.getHours();
    if (h < Math.max(fromHour, STORM_FROM_HOUR) || h > STORM_TO_HOUR) continue;
    if (isStormRiskHour(f)) return { level: 0, text: `Riesgo de tormenta desde las ${h} h` };
  }
  return null;
}

/** Everything for one day: official warnings first (highest level first), then the storm risk. */
export function dayNotices(day: Date, now: Date, mg: MGWarning[], ipma: IpmaWarning[], convection: HourlyForecast[]): DayNotice[] {
  const isToday = day.toDateString() === now.toDateString();
  const out = officialNotices(day, mg, ipma);
  // An official storm warning already says it; the model risk would repeat it.
  if (!out.some((n) => n.text.includes('por tormenta'))) {
    const storm = stormNotice(day, convection, isToday ? now.getHours() : STORM_FROM_HOUR);
    if (storm) out.push(storm);
  }
  return out;
}
