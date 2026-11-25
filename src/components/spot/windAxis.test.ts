import { describe, it, expect } from 'vitest';
import { buildWindAxis, windOutlook, windHeadline, towardsHour, modelGapWords, NEXT_H, PAST_H } from './windAxis';
import type { HourlyForecast } from '../../types/forecast';

const NOW = Date.parse('2026-11-05T12:00:00Z');
const H = 3_600_000;
const KT = 0.514444;
const hour = (offsetH: number, kt: number | null): HourlyForecast => ({
  time: new Date(NOW + offsetH * H),
  windSpeed: kt == null ? null : kt * KT,
} as HourlyForecast);

describe('buildWindAxis', () => {
  it('ends the measured line at the figure the card shows, and keeps only the window', () => {
    const axis = buildWindAxis(
      [{ t: NOW - (PAST_H + 1) * H, kt: 2 }, { t: NOW - H, kt: 6 }, { t: NOW - 2 * H, kt: 4 }],
      [],
      11,
      NOW,
    );
    expect(axis.measured.map((p) => p.kt)).toEqual([4, 6, 11]);
    expect(axis.measured.at(-1)).toEqual({ t: NOW, kt: 11 });
  });

  it('takes the model from the mark on, and the most it gives ahead', () => {
    const axis = buildWindAxis([], [hour(-1, 3), hour(1, 5), hour(4, 14), hour(NEXT_H + 2, 30)], 6, NOW);
    expect(axis.model.map((p) => Math.round(p.kt))).toEqual([3, 5, 14]);
    expect(Math.round(axis.peakNext!.kt)).toBe(14);
    expect(axis.peakNext!.t).toBe(NOW + 4 * H);
  });

  it('a model hour too far from now says nothing about now', () => {
    expect(buildWindAxis([], [hour(5, 9)], 6, NOW).modelNowKt).toBeNull();
    expect(Math.round(buildWindAxis([], [hour(-1, 9), hour(1, 3)], 6, NOW).modelNowKt!)).toBe(3);
  });

  it('a gap in the model is left out, never read as zero', () => {
    const axis = buildWindAxis([], [hour(1, null), hour(2, 7)], 6, NOW);
    expect(axis.model.map((p) => Math.round(p.kt))).toEqual([7]);
  });
});

describe('windOutlook', () => {
  const NOW = new Date(2026, 10, 5, 12, 0, 0).getTime();
  const at = (h: number, kt: number) => ({ t: new Date(2026, 10, 5, h).getTime(), kt });

  it('says when the model moves, and which way', () => {
    expect(windOutlook({ model: [at(12, 6), at(13, 7), at(14, 10)], modelNowKt: 6 }, NOW)).toBe('Más viento hacia las 14:00, según el modelo.');
    expect(windOutlook({ model: [at(12, 12), at(13, 11), at(14, 8)], modelNowKt: 12 }, NOW)).toBe('Menos viento hacia las 14:00, según el modelo.');
  });

  it('a model that stays put says so', () => {
    expect(windOutlook({ model: [at(12, 6), at(13, 7), at(14, 7)], modelNowKt: 6 }, NOW)).toBe('Sin cambios a la vista, según el modelo.');
  });

  it('counts the change from the model, not from the figure on the card', () => {
    // Measured 13, model 6 all afternoon: that is no change coming
    expect(windOutlook({ model: [at(13, 6), at(14, 6)], modelNowKt: 6 }, NOW)).toMatch(/^Sin cambios/);
  });

  it('nothing ahead, nothing said', () => {
    expect(windOutlook({ model: [at(11, 6)], modelNowKt: 6 }, NOW)).toBe('');
  });
});

describe('modelGapWords', () => {
  it('only a gap worth saying, and it does not judge', () => {
    expect(modelGapWords(13, 6)).toBe('Ahora el modelo va 7 kt por debajo de lo medido');
    expect(modelGapWords(4, 12)).toBe('Ahora el modelo va 8 kt por encima de lo medido');
    expect(modelGapWords(13, 10)).toBe('');
    expect(modelGapWords(13, null)).toBe('');
  });
});

describe('windHeadline: a model far from what is measured does not announce what comes', () => {
  const NOW = new Date(2026, 10, 11, 21, 0, 0).getTime();
  const at = (d: number, h: number, kt: number) => ({ t: new Date(2026, 10, d, h).getTime(), kt });
  const rising = { model: [at(11, 21, 0), at(11, 23, 1), at(12, 1, 4)], modelNowKt: 0 };

  it('7 kt apart: the gap is the sentence, no rise announced, and it is not said twice', () => {
    const h = windHeadline(rising, 7, NOW);
    expect(h.text).toBe('El modelo va 7 kt por debajo de lo medido: hoy no dice qué viene aquí.');
    expect(h.text).not.toMatch(/Más viento|Menos viento/);
    expect(h.gapSaid).toBe(true);
  });

  it('close to the measured figure: the model speaks as before', () => {
    const h = windHeadline(rising, 3, NOW);
    expect(h.text).toBe('Más viento hacia la 1:00, según el modelo.');
    expect(h.gapSaid).toBe(false);
  });

  it('nothing ahead: nothing said, gap or not', () => {
    expect(windHeadline({ model: [at(11, 20, 0)], modelNowKt: 0 }, 9, NOW)).toEqual({ text: '', gapSaid: false });
  });

  it('the hour reads as an hour: «la 1:00», «las 13:00»', () => {
    expect(towardsHour(new Date(2026, 10, 12, 1).getTime())).toBe('hacia la 1:00');
    expect(towardsHour(new Date(2026, 10, 12, 13).getTime())).toBe('hacia las 13:00');
    expect(towardsHour(new Date(2026, 10, 12, 0).getTime())).toBe('hacia las 0:00');
  });
});
