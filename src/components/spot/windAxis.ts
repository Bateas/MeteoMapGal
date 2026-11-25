/**
 * Measured wind and forecast wind on one axis: what happened, now, and what the model says comes. Pure.
 * The figure the head shows is the last measured point, so the line ends where the card says.
 */
import type { HourlyForecast } from '../../types/forecast';

export const PAST_H = 3;
export const NEXT_H = 9;
const MS_TO_KT = 1.94384;
/** A model hour further than this from now says nothing about now. */
const MODEL_NOW_MAX_MS = 90 * 60_000;

export interface AxisPoint {
  t: number;
  kt: number;
}

export interface WindAxis {
  measured: AxisPoint[];
  model: AxisPoint[];
  /** What the model gives for this moment, if it has an hour close enough */
  modelNowKt: number | null;
  /** The most the model gives ahead */
  peakNext: AxisPoint | null;
  from: number;
  to: number;
}

/** Half the top of each scale: 10 kt, 20, 30, 40, 60 and 100. */
const SCALE_STEPS = [5, 10, 15, 20, 30, 50];

/**
 * A scale anyone can read: 0 and two round figures, the same ladder on every wind chart, so the same height means
 * about the same wind on a spot and on a station. It starts at 10 kt so a calm day stays low in the chart.
 */
export function windScale(maxKt: number): { top: number; ticks: number[] } {
  const step = SCALE_STEPS.find((s) => maxKt <= s * 2) ?? SCALE_STEPS[SCALE_STEPS.length - 1];
  return { top: step * 2, ticks: [0, step, step * 2] };
}

export function buildWindAxis(past: AxisPoint[], forecast: HourlyForecast[], nowKt: number, now: number): WindAxis {
  const from = now - PAST_H * 3_600_000;
  const to = now + NEXT_H * 3_600_000;

  const measured = past
    .filter((p) => p.t >= from && p.t < now && Number.isFinite(p.kt))
    .sort((a, b) => a.t - b.t);
  measured.push({ t: now, kt: nowKt });

  const hours = forecast
    .filter((h) => h.windSpeed != null)
    .map((h) => ({ t: h.time.getTime(), kt: h.windSpeed! * MS_TO_KT }))
    .sort((a, b) => a.t - b.t);

  // Includes the hour just before now, so the dotted line starts at the mark and not an hour late
  const lastBefore = [...hours].reverse().find((h) => h.t <= now);
  const model = hours.filter((h) => h.t > now && h.t <= to);
  if (lastBefore && now - lastBefore.t <= MODEL_NOW_MAX_MS) model.unshift(lastBefore);

  let modelNowKt: number | null = null;
  let closest = MODEL_NOW_MAX_MS;
  for (const h of hours) {
    const gap = Math.abs(h.t - now);
    if (gap <= closest) {
      closest = gap;
      modelNowKt = h.kt;
    }
  }

  const ahead = model.filter((h) => h.t > now);
  const peakNext = ahead.length > 0 ? ahead.reduce((a, b) => (b.kt > a.kt ? b : a)) : null;

  return { measured, model, modelNowKt, peakNext, from, to };
}

/** The model has to move this much from where it stands now to count as a change. */
const OUTLOOK_MIN_KT = 3;
/** Under this, the two lines at the mark are the same thing as far as anyone is concerned. */
const GAP_WORTH_SAYING_KT = 5;

/**
 * What comes, in words. Measured from the model's own figure now, not from the one on the card: that one is
 * calibrated for the spot and the model is a bare point, so a steady difference between them is not a change.
 */
export function windOutlook(axis: Pick<WindAxis, 'model' | 'modelNowKt'>, now: number): string {
  const ahead = axis.model.filter((h) => h.t > now);
  if (ahead.length === 0) return '';
  const base = axis.modelNowKt ?? ahead[0].kt;
  const change = ahead.find((h) => Math.abs(h.kt - base) >= OUTLOOK_MIN_KT);
  if (!change) return 'Sin cambios a la vista, según el modelo.';
  return `${change.kt > base ? 'Más' : 'Menos'} viento ${towardsHour(change.t)}, según el modelo.`;
}

/** «hacia la 1:00», «hacia las 13:00». With the minutes, it cannot be read as «within 1 h». */
export function towardsHour(t: number): string {
  const h = new Date(t).getHours();
  return `hacia ${h === 1 ? 'la' : 'las'} ${h}:00`;
}

/**
 * The sentence over the chart. When the model stands far from what is measured right now (the same gap the
 * note under the chart states), it does not get to announce a rise or a drop: «Más viento hacia la 1:00,
 * según el modelo» sat right over «el modelo va 7 kt por debajo de lo medido» (Cesantes, 11-nov). The gap
 * is said once, here, and `gapSaid` tells the caller not to repeat it under the chart.
 */
export function windHeadline(axis: Pick<WindAxis, 'model' | 'modelNowKt'>, nowKt: number, now: number): { text: string; gapSaid: boolean } {
  const outlook = windOutlook(axis, now);
  const gap = modelGapWords(nowKt, axis.modelNowKt);
  if (!outlook || !gap) return { text: outlook, gapSaid: false };
  return { text: `${gap.replace(/^Ahora el modelo/, 'El modelo')}: hoy no dice qué viene aquí.`, gapSaid: true };
}

/**
 * Said only when it is plain to see in the lines and worth knowing: how far to go by the model today. States the
 * gap without judging it, since a steady one can be shelter and not a model error.
 */
export function modelGapWords(nowKt: number, modelNowKt: number | null): string {
  if (modelNowKt == null) return '';
  const gap = Math.round(modelNowKt - nowKt);
  if (Math.abs(gap) < GAP_WORTH_SAYING_KT) return '';
  return `Ahora el modelo va ${Math.abs(gap)} kt ${gap < 0 ? 'por debajo' : 'por encima'} de lo medido`;
}
