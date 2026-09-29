import { describe, it, expect } from 'vitest';
import { madridDay, daysToJudge, shadowSummary, HEALTH_SLOT } from './stationHealthJob';
import type { HealthVerdict } from '../src/services/stationHealth';

describe('stationHealthJob — the pure parts', () => {
  it('madridDay: 00:30 local on the 30th is the 30th, though it is still the 29th in UTC', () => {
    expect(madridDay(Date.parse('2026-09-29T22:30:00Z'))).toBe('2026-09-30');
    expect(madridDay(Date.parse('2026-09-29T21:30:00Z'))).toBe('2026-09-29');
  });

  it('daysToJudge: the 30 days before today, oldest first, never today, skipping the done ones', () => {
    const days = daysToJudge(new Set(['2026-09-28']), '2026-09-30');
    expect(days).toHaveLength(29);
    expect(days[0]).toBe('2026-08-31');
    expect(days[days.length - 1]).toBe('2026-09-29');
    expect(days).not.toContain('2026-09-28');
    expect(days).not.toContain('2026-09-30');
  });

  it('runs in the small hours, before the calibration', () => {
    expect(HEALTH_SLOT[0]).toBeGreaterThanOrEqual(0);
    expect(HEALTH_SLOT[1]).toBeLessThanOrEqual(3);
  });

  it('shadowSummary says it removes nothing, and names what would be out', () => {
    const v = (stationId: string, out: boolean): HealthVerdict => ({
      stationId, variable: 'temperature', strikeDays: out ? 3 : 1, firstDay: '2026-09-10', lastDay: '2026-09-29', rules: ['picos'], out,
    });
    expect(shadowSummary([])).toBe('[Salud] en sombra (no se quita nada): 0 variables fuera en 0 estaciones');
    const line = shadowSummary([v('mg_10087', true), v('wu_X', false)]);
    expect(line).toContain('1 variables fuera en 1 estaciones');
    expect(line).toContain('mg_10087 temperature (3 d: picos)');
    expect(line).not.toContain('wu_X');
  });
});
