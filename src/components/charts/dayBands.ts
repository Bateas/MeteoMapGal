/**
 * Today and tomorrow in three stretches each (morning, afternoon, night), for the first screen of
 * the forecast in simple mode: whoever opens it wants to know whether it rains, blows or is cold,
 * not the wind hour by hour. Built from the same hour columns as the table below, so both always
 * say the same. Pure: the clock comes in.
 */
import type { HourCol, Tone } from '../../services/forecastParte';
import { windTone } from '../../services/forecastParte';
import { getSunTimes } from '../../services/solarUtils';

export type BandId = 'manana' | 'tarde' | 'noche';

export interface DayBand {
  id: BandId;
  label: string;
  /** Hours the band covers, as said to the reader: «8-13 h». */
  span: string;
  tMin: number | null;
  tMax: number | null;
  /** Sum of the model's rain in the band, mm. */
  rainMm: number;
  /** The strongest mean wind of the band, kt, and the word the map uses for it. */
  windKt: number;
  tone: Tone;
  /** Any hour of the band with the model's sky saying storm. */
  storm: boolean;
  /** Mean cloud cover (%), null when the model gives none. */
  cloud: number | null;
}

export interface DayBands {
  key: string;
  label: string;
  /** The first hour of the day that is left, for the day's warnings. */
  from: Date;
  bands: DayBand[];
}

const BANDS: { id: BandId; label: string; from: number; to: number }[] = [
  { id: 'manana', label: 'De mañana', from: 7, to: 13 },
  { id: 'tarde', label: 'De tarde', from: 14, to: 20 },
  { id: 'noche', label: 'De noche', from: 21, to: 23 },
];

const STORM = /STORM|HAIL/;

/** Rain under this in a whole band is not said: the model's drizzle noise. */
export const BAND_RAIN_MIN_MM = 0.2;

/**
 * Up to `days` days from the hour columns. A band needs at least two of its hours left (one for the
 * short night band), so the afternoon at 20:30 is not summed up from a single hour; a day with no
 * band left is dropped.
 */
export function buildDayBands(cols: HourCol[], days = 2): DayBands[] {
  const out: DayBands[] = [];
  for (const c of cols) {
    let day = out.find((d) => d.key === c.dayKey);
    if (!day) {
      if (out.length >= days + 1) continue;
      day = { key: c.dayKey, label: c.dayLabel, from: c.time, bands: [] };
      out.push(day);
    }
  }
  for (const day of out) {
    const hours = cols.filter((c) => c.dayKey === day.key);
    for (const b of BANDS) {
      const inBand = hours.filter((h) => h.time.getHours() >= b.from && h.time.getHours() <= b.to);
      if (inBand.length < (b.id === 'noche' ? 1 : 2)) continue;
      const temps = inBand.map((h) => h.temp).filter((t): t is number => t != null);
      const clouds = inBand.map((h) => h.cloudCover).filter((v): v is number => v != null);
      const windKt = Math.max(...inBand.map((h) => h.kt));
      day.bands.push({
        id: b.id,
        label: b.label,
        span: `${inBand[0].time.getHours()}-${inBand[inBand.length - 1].time.getHours() + 1} h`,
        tMin: temps.length ? Math.round(Math.min(...temps)) : null,
        tMax: temps.length ? Math.round(Math.max(...temps)) : null,
        rainMm: inBand.reduce((sum, h) => sum + h.rainMm, 0),
        windKt: Math.round(windKt),
        tone: windTone(windKt),
        storm: inBand.some((h) => h.skyState != null && STORM.test(h.skyState)),
        cloud: clouds.length ? clouds.reduce((a, v) => a + v, 0) / clouds.length : null,
      });
    }
  }
  return out.filter((d) => d.bands.length > 0).slice(0, days);
}

/** The sky of a band in one icon: storm, rain, or the cloud cover. */
export function bandSky(b: DayBand): 'zap' | 'cloud-rain' | 'sun' | 'moon' | 'cloud-sun' | 'cloud' | null {
  if (b.storm) return 'zap';
  if (b.rainMm >= BAND_RAIN_MIN_MM) return 'cloud-rain';
  if (b.cloud == null) return null;
  if (b.cloud < 15) return b.id === 'noche' ? 'moon' : 'sun';
  if (b.cloud < 70) return b.id === 'noche' ? 'cloud' : 'cloud-sun';
  return 'cloud';
}

/** «12-15°», or «14°» when the band does not move. */
export function bandTemp(b: DayBand): string | null {
  if (b.tMin == null || b.tMax == null) return null;
  return b.tMin === b.tMax ? `${b.tMax}°` : `${b.tMin}-${b.tMax}°`;
}

/** «2,4 mm», «12 mm» from ten up, or «Sin lluvia». */
export function bandRain(b: DayBand): string {
  if (b.rainMm < BAND_RAIN_MIN_MM) return 'Sin lluvia';
  return `${b.rainMm >= 10 ? Math.round(b.rainMm) : b.rainMm.toFixed(1).replace('.', ',')} mm`;
}

/** The accessible sentence of a band, the one a screen reader gets. */
export function bandLabel(dayLabel: string, b: DayBand): string {
  const temp = bandTemp(b);
  const rain = b.rainMm >= BAND_RAIN_MIN_MM ? `lluvia, ${bandRain(b)}` : 'sin lluvia';
  return `${dayLabel}, ${b.label.toLowerCase()} (${b.span}): ${b.storm ? 'tormenta, ' : ''}${rain}${temp ? `, ${temp.replace('-', ' a ')}` : ''}, viento hasta ${b.windKt} nudos`;
}

const clock = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * When there is daylight on a day of the summary, beside its name: «sol de 8:18 a 18:14». On a phone
 * the header does not carry the sun hours, and whoever plans a walk or an evening at the beach asks
 * exactly this. Today after sunset says nothing: the hour is past, and tomorrow's line gives the next
 * sunrise. Null when the sun does not rise or set that day (never in Galicia; the function is general).
 */
export function sunLine(day: Date, now: Date, center: [number, number]): string | null {
  const { sunrise, sunset } = getSunTimes(day, center);
  if (!Number.isFinite(sunrise.getTime()) || !Number.isFinite(sunset.getTime())) return null;
  const sameDay = day.getFullYear() === now.getFullYear() && day.getMonth() === now.getMonth() && day.getDate() === now.getDate();
  if (sameDay && now.getTime() >= sunset.getTime()) return null;
  return `sol de ${clock(sunrise)} a ${clock(sunset)}`;
}
