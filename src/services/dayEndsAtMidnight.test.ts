/**
 * The two days a year the clock changes have 23 and 25 hours (P3 review, batch 2). The end of a day was «+24 h»:
 * on 29-mar the first hour of the 30th fell into the 29th. The zone is pinned so the case exists wherever this runs.
 */
// Through globalThis: the app tsconfig carries no Node types (the same trick as bootTokens.test.ts)
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Madrid';
import { describe, it, expect } from 'vitest';
import { officialNotices } from './dayNotices';
import { forecastLines } from './alerts/conditionsList';
import type { MGWarning } from '../api/mgWarningsClient';
import type { HourlyForecast } from '../types/forecast';

const springDay = new Date(2026, 2, 29, 12, 0);   // Sunday 29-mar-2026: 02:00 jumps to 03:00, a 23-hour day
const nextMidnight = new Date(2026, 2, 30, 0, 0);

describe('a day ends at its next midnight, also when the clock changes', () => {
  it('a warning that starts at midnight of the 30th is not said on the 29th', () => {
    const w: MGWarning = {
      type: 'Vento', typeId: 3, maxLevel: 1, publishedAt: new Date(2026, 2, 29, 8), link: '',
      zones: [{ name: 'Rías Baixas de Pontevedra', id: 336, level: 1, startTime: nextMidnight, endTime: new Date(2026, 2, 30, 6), comment: '' }],
    };
    expect(officialNotices(springDay, [w], [])).toHaveLength(0);
    expect(officialNotices(nextMidnight, [w], [])).toHaveLength(1);
  });

  it('rain at midnight of the 30th is «mañana», not «hoy de 0 a 1 h»', () => {
    const now = new Date(2026, 2, 29, 20, 0);
    const hourly = [{ time: nextMidnight, precipitation: 3, precipProbability: 90, temperature: 10 } as HourlyForecast];
    const rain = forecastLines(hourly, [], now).find((l) => /Lluvia/.test(l.text));
    expect(rain?.text).toMatch(/mañana/);
    expect(rain?.text).not.toMatch(/hoy/);
  });
});
