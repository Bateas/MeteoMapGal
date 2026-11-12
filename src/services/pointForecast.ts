/**
 * What a weather point shows: rain, wind and temperature hour by hour at that exact point (WRF 1 km)
 * and the official warnings of its own zone. Pure, so the card only draws.
 *
 * Warnings go by the zone NAME the feed sends, not by id: the ids in getWarningsForSector do not match
 * the feed (334 is «Litoral Pontevedra» there, not the Miño).
 */
import type { HourlyForecast } from '../types/forecast';
import type { MGWarning } from '../api/mgWarningsClient';
import type { GaugeRain } from '../api/meteoPointStatusClient';
import { msToKnots, degToCardinal8 } from './windUtils';

const TZ = 'Europe/Madrid';
export const MORNING_FROM_H = 8;
export const MORNING_TO_H = 14;
/** The hours the chart covers. */
export const STRIP_FROM_H = 7;
export const STRIP_TO_H = 20;
/** Below this the model is only drawing noise: the hour counts as dry. */
export const DRY_MM = 0.1;

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });
const labelFmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'short', day: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'long' });
const shortFmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const dayKey = (d: Date) => dayFmt.format(d);
export const localHour = (d: Date) => Number(hourFmt.format(d));

/** mm with the decimal comma the rest of the card reads with. */
export const fmtMm = (v: number) => (v < 10 ? v.toFixed(1) : v.toFixed(0)).replace('.', ',');

export interface PointHour {
  hour: number;
  rainMm: number | null;
  kt: number | null;
  dirDeg: number | null;
  /** Cardinal of dirDeg, '' without one. */
  dir: string;
  temp: number | null;
}

export interface DaySummary {
  dayKey: string;
  /** «lun 9» */
  label: string;
  /** One entry per hour from STRIP_FROM_H to STRIP_TO_H; nulls where the model gives nothing. */
  hours: PointHour[];
  /** The rainy stretches of those hours. */
  bands: RainBand[];
}

export interface RainBand {
  fromH: number;
  toH: number;
  mm: number;
}

/** Runs of rainy hours. One dry hour splits a band: a dry hour is what someone outdoors is looking for. */
export function rainBands(rain: (number | null)[], firstHour = STRIP_FROM_H): RainBand[] {
  const bands: RainBand[] = [];
  let open: RainBand | null = null;
  rain.forEach((mm, i) => {
    if (mm === null || mm < DRY_MM) { open = null; return; }
    if (open) { open.toH = firstHour + i; open.mm += mm; return; }
    open = { fromH: firstHour + i, toH: firstHour + i, mm };
    bands.push(open);
  });
  return bands;
}

/** 0 dry, 1 light (under 0.5 mm/h), 2 moderate (under 2), 3 heavy. */
export function rainLevel(mm: number | null): 0 | 1 | 2 | 3 {
  if (mm === null || mm < DRY_MM) return 0;
  return mm < 0.5 ? 1 : mm < 2 ? 2 : 3;
}

/** The map's wind scale: calm, light, sailing, good, strong. */
export function windTone(kt: number | null): 0 | 1 | 2 | 3 | 4 {
  const k = Math.round(kt ?? 0);
  return k < 6 ? 0 : k < 8 ? 1 : k < 12 ? 2 : k < 18 ? 3 : 4;
}

/** «Llueve 7-8, 11-14 y 19-20 h». */
export function describeBands(bands: RainBand[]): string {
  if (bands.length === 0) return `Sin lluvia de ${STRIP_FROM_H} a ${STRIP_TO_H} h`;
  const parts = bands.map((b) => (b.fromH === b.toH ? `${b.fromH}` : `${b.fromH}-${b.toH}`));
  const last = parts.pop()!;
  return `Llueve ${parts.length ? `${parts.join(', ')} y ${last}` : last} h`;
}

/** The next `days` days that still have hours to come; a day the model does not reach is left out. */
export function summarizeDays(hours: HourlyForecast[], now: Date, days = 3): DaySummary[] {
  const byDay = new Map<string, HourlyForecast[]>();
  for (const h of hours) {
    const k = dayKey(h.time);
    const list = byDay.get(k);
    if (list) list.push(h); else byDay.set(k, [h]);
  }
  const today = dayKey(now);
  const todayOver = localHour(now) >= STRIP_TO_H;
  const out: DaySummary[] = [];
  for (const k of [...byDay.keys()].sort()) {
    if (out.length >= days) break;
    if (k < today || (k === today && todayOver)) continue;
    const inRange = byDay.get(k)!.filter((h) => { const x = localHour(h.time); return x >= STRIP_FROM_H && x <= STRIP_TO_H; });
    if (inRange.length === 0) continue;
    const row: PointHour[] = Array.from({ length: STRIP_TO_H - STRIP_FROM_H + 1 }, (_, i) => {
      const hour = STRIP_FROM_H + i;
      const h = inRange.find((x) => localHour(x.time) === hour);
      return {
        hour,
        rainMm: h?.precipitation ?? null,
        kt: h?.windSpeed == null ? null : msToKnots(h.windSpeed),
        dirDeg: h?.windDirection ?? null,
        dir: h?.windDirection == null ? '' : degToCardinal8(h.windDirection),
        temp: h?.temperature ?? null,
      };
    });
    out.push({
      dayKey: k,
      label: labelFmt.format(inRange[0].time).replace(',', ''),
      hours: row,
      bands: rainBands(row.map((r) => r.rainMm)),
    });
  }
  return out;
}

/** Rain the sentence announces: the same line as the comparison with the gauges. The chart still draws less. */
const NEXT_RAIN_MM = 0.3;
/** Further ahead, the hour a spell of rain ends moves by hours between model runs: said by part of the day. */
const EXACT_END_H = 6;
const partOfDay = (h: number) => (h < 7 ? 'madrugada' : h < 13 ? 'mañana' : h < 21 ? 'tarde' : 'noche');

/** One sentence: when the model next has rain here, roughly, and how much that shower leaves. */
export function describeNextRain(hours: HourlyForecast[], now: Date): string | null {
  const nowMs = now.getTime();
  const ahead = hours
    .filter((h) => h.time.getTime() >= nowMs - 30 * 60_000)
    .sort((a, b) => a.time.getTime() - b.time.getTime());
  if (ahead.length === 0) return null;
  const wet = (h: HourlyForecast) => (h.precipitation ?? 0) >= NEXT_RAIN_MM;
  const when = (h: HourlyForecast) => {
    const hh = localHour(h.time);
    return `hacia ${hh === 1 ? 'la' : 'las'} ${hh} h${dayKey(h.time) === dayKey(now) ? '' : ` del ${weekdayFmt.format(h.time)}`}`;
  };

  const ends = (h: HourlyForecast) => {
    if (h.time.getTime() - nowMs <= EXACT_END_H * 3_600_000) return when(h);
    return `por la ${partOfDay(localHour(h.time))}${dayKey(h.time) === dayKey(now) ? '' : ` del ${weekdayFmt.format(h.time)}`}`;
  };

  // «Now» only once that hour has begun: the next hour, 15 min away, read as «it is raining now».
  if (wet(ahead[0]) && ahead[0].time.getTime() <= nowMs) {
    const dry = ahead.find((h) => !wet(h));
    return dry ? `Según el modelo llueve ahora. Para ${ends(dry)}` : 'Según el modelo llueve ahora, sin final a la vista';
  }
  const first = ahead.findIndex(wet);
  if (first < 0) {
    return `El modelo no da lluvia en las próximas ${Math.round((ahead[ahead.length - 1].time.getTime() - nowMs) / 3_600_000)} h`;
  }
  let end = first;
  while (ahead[end + 1] && wet(ahead[end + 1])) end++;
  const shower = ahead.slice(first, end + 1);
  const total = shower.reduce((a, h) => a + (h.precipitation ?? 0), 0);
  const inMin = (ahead[first].time.getTime() - nowMs) / 60_000;
  const inH = Math.max(1, Math.round(inMin / 60));
  const lead = inH >= 24 || inMin <= 45 ? 'Lluvia' : inH === 1 ? 'Lluvia en 1 h aprox.,' : `Lluvia en unas ${inH} h,`;
  return `${lead} ${when(ahead[first])}: ${fmtMm(total)} mm en ${shower.length} h`;
}

export interface ZoneWarning {
  key: string;
  /** In Spanish where we know the name; the feed's own otherwise. */
  type: string;
  zone: string;
  level: number;
  /** Already in force. */
  active: boolean;
  startLabel: string;
  endLabel: string;
  comment: string;
}

const TYPE_ES: [RegExp, string][] = [
  [/refacho/i, 'Rachas de viento'],
  [/precipitaci.n 1 hora/i, 'Lluvia en 1 hora'],
  [/precipitaci.n 12/i, 'Lluvia en 12 horas'],
  [/treboada|tormenta/i, 'Tormenta'],
  [/neve|nieve/i, 'Nieve'],
  [/n.boa|niebla/i, 'Niebla'],
  [/ondas|olas/i, 'Olas'],
  [/vento|viento/i, 'Viento'],
];
export function warningTypeEs(type: string): string {
  return TYPE_ES.find(([re]) => re.test(type))?.[1] ?? type;
}

/** Official warnings not yet over in exactly these zones, soonest first; one line per kind and zone. */
/** Echo that counts as rain over a point: the cut of the rain layer, and only a recent frame. */
const RADAR_RAIN_DBZ = 20;
const RADAR_MAX_AGE_MIN = 25;

/**
 * What the radar shows right over a point, or null. Only ever says rain is there: an empty radar proves
 * nothing, since light rain from low cloud passes under the beam (9-nov, 09:52: rain, and no echo).
 */
export function describeRadarOverPoint(maxDbz: number | null, ageMin: number | null): string | null {
  if (maxDbz === null || ageMin === null || maxDbz < RADAR_RAIN_DBZ || ageMin > RADAR_MAX_AGE_MIN) return null;
  const strength = maxDbz >= 40 ? 'fuerte' : maxDbz >= 30 ? 'moderada' : 'débil';
  return `El radar ve lluvia ${strength} encima, ${ageMin <= 1 ? 'ahora' : `hace ${ageMin} min`}.`;
}

const SAYS_NOT_MEASURED = new Set(['seco', 'se-acerca', 'no-llega']);

/**
 * The sentence from the server can be 10-15 min behind the gauges on the map, so when one of them has just
 * measured rain and the sentence still says none has, the card says what was measured (9-nov: 0,4 on the
 * map, «no mide lluvia» on the card). Only the words of the card: the watcher and its exam do not change.
 */
export function panoramaWithLiveGauge<T extends { state: string; text: string }>(
  status: T | null,
  gauge: { name: string; mmPerHour: number } | null,
): T | null {
  if (!status || !gauge || !SAYS_NOT_MEASURED.has(status.state)) return status;
  return { ...status, text: `${gauge.name} acaba de medir lluvia (${fmtMm(gauge.mmPerHour)} mm/h), aún sin comparar con el WRF.` };
}

export function warningsForZones(warnings: MGWarning[], zones: string[], now: Date): ZoneWarning[] {
  const wanted = zones.map((z) => z.toLowerCase());
  const best = new Map<string, ZoneWarning & { startMs: number }>();
  for (const w of warnings) {
    for (const z of w.zones) {
      if (z.endTime.getTime() <= now.getTime() || !wanted.includes(z.name.trim().toLowerCase())) continue;
      const key = `${w.typeId}|${z.name}`;
      const startMs = z.startTime.getTime();
      if ((best.get(key)?.startMs ?? Infinity) <= startMs) continue;
      best.set(key, {
        key,
        type: warningTypeEs(w.type),
        zone: z.name,
        level: z.level,
        active: startMs <= now.getTime(),
        startLabel: shortFmt.format(z.startTime).replace(',', ''),
        endLabel: shortFmt.format(z.endTime).replace(',', ''),
        comment: z.comment.trim(),
        startMs,
      });
    }
  }
  return [...best.values()].sort((a, b) => a.startMs - b.startMs);
}

/** Readings of a 10-minute gauge in each window, and the share under which a total is a floor. */
const GAUGE_ROWS = { h24: 144, d3: 432, d7: 1008 } as const;
const GAUGE_MIN_COVERAGE = 0.9;
/** Under this share of the day the gauge is barely reporting: the card names how many readings came. */
const GAUGE_SPARSE_COVERAGE = 0.5;
const GAUGE_STALE_MIN = 180;
const GAUGE_LATE_MIN = 40;
/** The nearby station speaks only with nine tenths of the day behind it and a reading of the last 90 min. */
const WITNESS_MIN_COVERED_MIN = 24 * 60 * 0.9;
const WITNESS_STALE_MIN = 90;
const clockFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });

export interface GaugeRainView {
  gauge: string;
  /** `floor`: readings are missing in that window, the figure is a minimum («más de»). */
  cells: { label: string; mm: string; floor?: true }[];
  note: string | null;
}

/**
 * The rain already fallen, as the gauge measured it: the state of the ground depends on it and no
 * forecast says it. It says what was measured and where, never how wet the ground is: that needs
 * the soil itself. A silent gauge gives no figure rather than an old one.
 */
export function describeGaugeRain(r: GaugeRain | null, now: Date): GaugeRainView | null {
  if (!r?.gauge || !r.lastAt) return null;
  const ageMin = (now.getTime() - new Date(r.lastAt).getTime()) / 60_000;
  if (!(ageMin <= GAUGE_STALE_MIN)) return null;
  // A window with readings missing is a floor, not a total: the cell says so itself («más de 1,1»).
  // On 11-nov Amiudal sent 4 of its 84 readings of the morning and the card read «1,1 mm» as the
  // rain of the day, with about ten times that falling around it.
  const short = (n: number, expected: number) => n < expected * GAUGE_MIN_COVERAGE;
  const cell = (label: string, mm: number, floor: boolean) => {
    const figure = mm < 0.05 ? '0' : fmtMm(mm);
    return floor ? { label, mm: figure, floor: true as const } : { label, mm: figure };
  };
  const floor24 = short(r.n24h, GAUGE_ROWS.h24);
  const floor3d = short(r.n3d, GAUGE_ROWS.d3);
  const floor7d = short(r.n7d, GAUGE_ROWS.d7);
  const sparse = r.n24h < GAUGE_ROWS.h24 * GAUGE_SPARSE_COVERAGE;
  const w = r.witness;
  const witnessOk = !!w && !!w.lastAt && w.coveredMin >= WITNESS_MIN_COVERED_MIN
    && now.getTime() - new Date(w.lastAt).getTime() <= WITNESS_STALE_MIN * 60_000;
  // A gauge that barely reports does not lead the card: on 12-nov the big figure read «más de 1,1 mm»
  // from Amiudal (25 of 144 readings) with Surribas at 19 mm just below. The complete nearby station
  // gives the day, named as what it is; the official one says why it is not the figure.
  if (sparse && witnessOk && w && w.mm24h > r.mm24h) {
    return {
      gauge: `${w.gauge}, estación particular cercana`,
      cells: [cell('24 h', w.mm24h, false)],
      note: `${r.gauge}, la estación oficial, solo ha enviado ${r.n24h} de sus ${GAUGE_ROWS.h24} lecturas de las últimas 24 h: no sirve para el total.`,
    };
  }
  const notes: string[] = [];
  if (sparse) {
    notes.push(`${r.gauge} solo ha enviado ${r.n24h} de sus ${GAUGE_ROWS.h24} lecturas de las últimas 24 h: la cifra es un mínimo, no el total.`);
  } else if (floor24 || floor3d || floor7d) {
    notes.push('Faltan lecturas: lo caído es como mínimo esto.');
  }
  if (ageMin > GAUGE_LATE_MIN) notes.push(`Última lectura a las ${clockFmt.format(new Date(r.lastAt))}.`);
  // Another station nearby gives the size of what fell, never the figure of the point: «unos».
  if (w && witnessOk && w.mm24h > r.mm24h) {
    notes.push(`${w.gauge}, estación particular cercana, midió unos ${fmtMm(w.mm24h)} mm en 24 h.`);
  }
  return {
    gauge: r.gauge,
    cells: [cell('24 h', r.mm24h, floor24), cell('3 días', r.mm3d, floor3d), cell('7 días', r.mm7d, floor7d)],
    note: notes.length > 0 ? notes.join(' ') : null,
  };
}
