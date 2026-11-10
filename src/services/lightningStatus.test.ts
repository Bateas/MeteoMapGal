import { describe, it, expect } from 'vitest';
import { lightningStatus, formatStrikeAge, formatStrikeKm } from './lightningStatus';

const NOW = Date.UTC(2026, 5, 14, 15, 0, 0);
const C = { lat: 42.29, lon: -8.1 };
const north = (km: number, minAgo: number) => ({ lat: C.lat + km / 111.2, lon: C.lon, timestamp: NOW - minAgo * 60_000 });
const status = (strikes: ReturnType<typeof north>[], level: Parameters<typeof lightningStatus>[3]) =>
  lightningStatus(strikes, C.lat, C.lon, level, NOW);

describe('lightningStatus: says what was measured', () => {
  it('nothing in 30 min within 80 km: no state, no words', () => {
    const s = status([north(120, 5), north(10, 45)], 'none');
    expect(s.level).toBe('none');
    expect(s.headline).toBe('');
    expect(s.chip).toBe('RAYOS');
    expect(s.action).toBeNull();
  });

  it('far strikes: distance of the nearest, count and age of the last, no advice', () => {
    const s = status([north(55, 12), north(70, 20), north(62, 6)], 'watch');
    expect(s.level).toBe('watch');
    expect(s.headline).toBe('Rayos a 55 km');
    expect(s.detail).toBe('3 en 30 min a menos de 80 km · último hace 6 min');
    expect(s.chip).toBe('55 km');
    expect(s.action).toBeNull();
  });

  it('aviso: both rings and the validated advice', () => {
    const s = status([north(18, 4), north(20, 9), north(22, 15), north(60, 2)], 'warning');
    expect(s.chip).toBe('AVISO');
    expect(s.headline).toBe('Rayos a 18 km');
    expect(s.detail).toBe('4 en 30 min a menos de 80 km, 3 a menos de 25 km · último hace 2 min');
    expect(s.action).toBe('Tormenta activa cerca: no te alejes de la orilla.');
  });

  it('peligro: overhead', () => {
    const s = status([north(0.4, 0.5), north(3, 2)], 'danger');
    expect(s.chip).toBe('PELIGRO');
    expect(s.headline).toBe('Rayos a menos de 1 km');
    expect(s.detail).toBe('2 en 30 min a menos de 25 km · último hace menos de 1 min');
    expect(s.action).toBe('Fuera del agua y a cubierto.');
  });

  it('a stale level with no strike left in the window says nothing', () => {
    expect(status([north(5, 40)], 'danger').level).toBe('none');
  });

  it('a strike in the window with the level not yet computed still shows as measured', () => {
    expect(status([north(40, 3)], 'none').level).toBe('watch');
  });

  // The rule this file exists for: measured distance and age only. A percentage, an arrival time
  // or a «probable» in any state means a promise crept back in.
  it('never a percentage, an arrival time or a forecast word', () => {
    const cases = [
      status([north(55, 12)], 'watch'),
      status([north(18, 4), north(20, 9), north(22, 15)], 'warning'),
      status([north(2, 1), north(3, 2)], 'danger'),
    ];
    for (const s of cases) {
      const text = `${s.chip} ${s.headline} ${s.detail} ${s.action ?? ''}`;
      expect(text).not.toMatch(/%|ETA|llega|inminente|probable|predicci|en la pr[oó]xima/i);
    }
  });
});

describe('formatters', () => {
  it('distance', () => {
    expect(formatStrikeKm(0.4)).toBe('menos de 1 km');
    expect(formatStrikeKm(12.4)).toBe('12 km');
  });
  it('age', () => {
    expect(formatStrikeAge(0.3)).toBe('último hace menos de 1 min');
    expect(formatStrikeAge(7.6)).toBe('último hace 8 min');
  });
});
