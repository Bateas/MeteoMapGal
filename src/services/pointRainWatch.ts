/**
 * How the rain at a weather point is going against the WRF: what the nearby gauges measured, next to
 * what the model said BEFORE each hour. Pure: the server runs it, sends the changes to Telegram and the
 * card shows the same sentence.
 *
 * It says what was measured and reads it as ahead or behind only when the gauges allow it. A gauge with
 * no recent reading says nothing (MeteoGalicia stops publishing some weekday mornings): that is «no
 * data», never «dry». One amateur gauge never decides alone; an official one can.
 *
 * «dry» below only means the gauge stayed under its threshold, so the sentences say what it measured and
 * never that it is dry there: on 9-nov it rained lightly on the point at 09:52 and 10:50 with 0 mm at the
 * nearest gauge, and the radar had nothing over it at 09:50.
 */
import { rainInWindowMm, type PrecipSample } from './precipSemantics';
import { isOfficialGauge } from './rainNowService';
import { fmtMm, localHour } from './pointForecast';

/** Under this the model is drawing a trace, not rain. */
export const MODEL_WET_MM = 0.3;
export const GAUGE_WET_MM = 0.2;
/** A gauge counts for a window only if it reported in the last minutes of it. */
export const GAUGE_FRESH_MIN = 45;
const HOUR_MS = 3_600_000;
const WINDOW_LOOKBACK_H = 6;
const NEXT_RAIN_SOON_H = 2;
const NEXT_RAIN_LOOKAHEAD_H = 8;
const NEXT_RAIN_MENTION_H = 12;

export interface WatchGauge {
  id: string;
  name: string;
  samples: PrecipSample[];
}

export interface ModelHour {
  timeMs: number;
  mm: number | null;
}

export type PanoramaState =
  | 'sin-dato' | 'seco' | 'se-acerca' | 'coincide' | 'adelanta' | 'retrasa' | 'no-previsto' | 'no-llega' | 'ya-paso';

export interface Panorama {
  state: PanoramaState;
  text: string;
  /** Same while it is the same event: what a notification is deduplicated on. Empty = never notified. */
  key: string;
}

/** `dry` = under the threshold, which is not the same as nothing: `mm` is what its official gauge did mark. */
type Zone = { state: 'wet'; mm: number; name: string } | { state: 'dry'; name: string; mm: number } | { state: 'unknown' };

function zone(gauges: WatchGauge[], endMs: number, windowMin: number): Zone {
  const read = gauges.flatMap((g) => {
    const newest = g.samples.reduce((m, s) => (s.t <= endMs && s.t > m ? s.t : m), -Infinity);
    if (endMs - newest > GAUGE_FRESH_MIN * 60_000) return [];
    const mm = rainInWindowMm(g.id, g.samples, endMs, windowMin);
    return mm === null ? [] : [{ g, mm }];
  });
  const wet = read.filter((r) => r.mm >= GAUGE_WET_MM).sort((a, b) => b.mm - a.mm);
  if (wet.some((r) => isOfficialGauge(r.g.id)) || wet.length >= 2) return { state: 'wet', mm: wet[0].mm, name: wet[0].g.name };
  const official = read.find((r) => isOfficialGauge(r.g.id));
  return official ? { state: 'dry', name: official.g.name, mm: official.mm } : { state: 'unknown' };
}

const atHour = (h: number) => `${h === 1 ? 'la' : 'las'} ${h} h`;

/** What a gauge under the threshold says of the last hour. 10-nov-2026: «no ha medido nada» with 0,1 mm
 *  marked and drizzle falling on the point. Words only: the states and the thresholds do not move. */
const dryNow = (z: { name: string; mm: number }) =>
  z.mm > 0 ? `${z.name} marca llovizna (${fmtMm(z.mm)} mm en la última hora)` : `${z.name} no mide lluvia`;

const NO_DATA: Panorama = {
  state: 'sin-dato',
  text: 'Sin datos recientes de las estaciones cercanas: ahora no se puede comparar con el WRF.',
  key: '',
};

export function pointRainPanorama(opts: { model: ModelHour[]; gauges: WatchGauge[]; nowMs: number }): Panorama {
  const { model, gauges, nowMs } = opts;
  const last = zone(gauges, nowMs, 60);
  if (last.state === 'unknown' || model.length === 0) return NO_DATA;

  const nowH = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const byHour = new Map(model.map((m) => [m.timeMs, m.mm]));
  const wetAt = (k: number) => (byHour.get(nowH + k * HOUR_MS) ?? 0) >= MODEL_WET_MM;
  const hourAt = (k: number) => localHour(new Date(nowH + k * HOUR_MS));
  const firstWet = (from: number, to: number) => {
    for (let k = from; k <= to; k++) if (wetAt(k)) return k;
    return null;
  };
  const threeHourKey = Math.floor(nowMs / (3 * HOUR_MS));

  if (last.state === 'wet') {
    const rain = `${last.name} (${fmtMm(last.mm)} mm en la última hora)`;
    // Just after starting there is no stored forecast for this hour: «the model did not have it» would be a guess.
    if (!byHour.has(nowH) && !byHour.has(nowH - HOUR_MS)) {
      return { state: 'sin-dato', text: `Llueve en ${rain}. Aún no hay previsión guardada de estas horas para compararla con el WRF.`, key: '' };
    }
    if ([-1, 0, 1].some(wetAt)) {
      return { state: 'coincide', text: `Llueve en ${rain}, como daba el WRF.`, key: `coincide:${threeHourKey}` };
    }
    const next = firstWet(2, NEXT_RAIN_LOOKAHEAD_H);
    if (next !== null) {
      return {
        state: 'adelanta',
        text: `Ya llueve en ${rain} y el WRF no la daba hasta ${atHour(hourAt(next))}: va unas ${next} h adelantada.`,
        key: `adelanta:${threeHourKey}`,
      };
    }
    for (let k = -2; k >= -WINDOW_LOOKBACK_H; k--) {
      if (wetAt(k)) {
        return {
          state: 'retrasa',
          text: `Llueve en ${rain} y el WRF la daba hacia ${atHour(hourAt(k))}: va unas ${-k} h retrasada.`,
          key: `retrasa:${threeHourKey}`,
        };
      }
    }
    return { state: 'no-previsto', text: `Llueve en ${rain} y el WRF no lo daba.`, key: `no-previsto:${threeHourKey}` };
  }

  // Dry now. Rain the model already had in the last hours: where did it go?
  const recent = [-1, -2, -3].find(wetAt);
  if (recent !== undefined) {
    let start = recent;
    while (start > -WINDOW_LOOKBACK_H && wetAt(start - 1)) start--;
    const startMs = nowH + start * HOUR_MS;
    const since = zone(gauges, nowMs, (nowMs - (startMs - HOUR_MS)) / 60_000);
    if (since.state === 'dry') {
      const before = zone(gauges, startMs - HOUR_MS, 180);
      if (before.state === 'wet') {
        return {
          state: 'ya-paso',
          text: `Ya pasó por ${before.name}: midió ${fmtMm(before.mm)} mm antes de ${atHour(hourAt(start))}, que es cuando la daba el WRF.`,
          key: `ya-paso:${startMs}`,
        };
      }
      return {
        state: 'no-llega',
        text: since.mm > 0
          ? `El WRF daba lluvia a ${atHour(hourAt(start))} y ${since.name} solo ha medido ${fmtMm(since.mm)} mm: es llovizna, o lo que daba el modelo aún no ha llegado.`
          : `El WRF daba lluvia a ${atHour(hourAt(start))} y ${last.name} no ha medido nada: aún no ha llegado, no llegará o es tan débil que no marca.`,
        key: `no-llega:${startMs}`,
      };
    }
  }

  const soon = firstWet(0, NEXT_RAIN_SOON_H);
  if (soon !== null) {
    return {
      state: 'se-acerca',
      text: `${dryNow(last)}. El WRF ${last.mm > 0 ? 'da lluvia' : 'la da'} ${soon === 0 ? 'para esta hora' : `hacia ${atHour(hourAt(soon))}`}.`,
      key: `se-acerca:${nowH + soon * HOUR_MS}`,
    };
  }
  const later = firstWet(NEXT_RAIN_SOON_H + 1, NEXT_RAIN_MENTION_H);
  return {
    state: 'seco',
    text: later === null
      ? (last.mm > 0 ? `${dryNow(last)} y el WRF no da lluvia.` : `${last.name} no mide lluvia y el WRF tampoco la da.`)
      : `${dryNow(last)} y el WRF no ${last.mm > 0 ? 'da lluvia' : 'la da'} hasta ${atHour(hourAt(later))}.`,
    key: '',
  };
}
