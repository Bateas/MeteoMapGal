import { describe, it, expect } from 'vitest';
import { sortStations } from './stationSort';
import type { NormalizedReading, NormalizedStation } from '../types/station';

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);

const st = (id: string, name = id) => ({ id, name } as unknown as NormalizedStation);
const rd = (windSpeed: number | null, temperature: number | null, ageMin = 5) =>
  ({ windSpeed, temperature, timestamp: new Date(NOW - ageMin * 60_000) } as unknown as NormalizedReading);
const none = () => false;
const ids = (list: NormalizedStation[]) => list.map((s) => s.id);

describe('sortStations', () => {
  it('by wind, the strongest first', () => {
    const readings = new Map([['a', rd(2, 10)], ['b', rd(8, 11)], ['c', rd(5, 12)]]);
    expect(ids(sortStations([st('a'), st('b'), st('c')], readings, 'wind', NOW, none))).toEqual(['b', 'c', 'a']);
  });

  it('a station that stopped sending hours ago does not come first, however much wind it last read', () => {
    const readings = new Map([['vieja', rd(20, 10, 180)], ['nueva', rd(3, 10)]]);
    expect(ids(sortStations([st('vieja'), st('nueva')], readings, 'wind', NOW, none))).toEqual(['nueva', 'vieja']);
  });

  it('an anemometer set aside goes last in the wind order, and keeps its place in the others', () => {
    const readings = new Map([['apartada', rd(30, 20)], ['buena', rd(3, 10)]]);
    const aside = (id: string) => id === 'apartada';
    expect(ids(sortStations([st('apartada'), st('buena')], readings, 'wind', NOW, aside))).toEqual(['buena', 'apartada']);
    expect(ids(sortStations([st('apartada'), st('buena')], readings, 'temp', NOW, aside))).toEqual(['apartada', 'buena']);
  });

  it('by temperature, the warmest first and the ones without it last', () => {
    const readings = new Map([['a', rd(1, 10)], ['b', rd(1, null)], ['c', rd(1, 18)]]);
    expect(ids(sortStations([st('a'), st('b'), st('c')], readings, 'temp', NOW, none))).toEqual(['c', 'a', 'b']);
  });

  it('by name, in Spanish, whatever the readings', () => {
    const list = [st('1', 'Ñora'), st('2', 'Ábalo'), st('3', 'Nigrán')];
    expect(ids(sortStations(list, new Map(), 'name', NOW, none))).toEqual(['2', '3', '1']);
  });

  it('ties and the stations without data go by name, so rows do not swap at random', () => {
    const readings = new Map([['b', rd(5, 10)], ['a', rd(5, 10)]]);
    const list = [st('z'), st('b'), st('a'), st('c')];
    expect(ids(sortStations(list, readings, 'wind', NOW, none))).toEqual(['a', 'b', 'c', 'z']);
  });

  it('does not touch the array it was given', () => {
    const list = [st('b'), st('a')];
    sortStations(list, new Map(), 'name', NOW, none);
    expect(ids(list)).toEqual(['b', 'a']);
  });
});
