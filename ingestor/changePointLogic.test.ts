/**
 * «Cambio brusco»: a station that suddenly behaves unlike its own past against its
 * neighbours. Synthetic nights shaped on the cases of the dry run (exp_changepoint_1oct):
 * the Sanxenxo Netatmo whose wind went from 1.4x to 15x its neighbours (28-sep), a
 * thermometer frozen at a warm value, a cape station that always reads more (fine),
 * and a front night that moves many stations at once (weather, not sensors).
 */
import { describe, it, expect } from 'vitest';
import { changePointStrikes, cpNeighbours, type CpStation, type NightMean } from './changePointLogic.js';

const NIGHTS = Array.from({ length: 31 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 8, 1 + i));
  return d.toISOString().slice(0, 10);
}); // 2026-09-01 .. 2026-10-01
const LAST = NIGHTS[NIGHTS.length - 1];

// Six stations within a few km, at similar heights, plus one far up the hill.
const STATIONS: CpStation[] = [
  { id: 'a', lat: 42.40, lon: -8.80, alt: 20 },
  { id: 'b', lat: 42.41, lon: -8.81, alt: 30 },
  { id: 'c', lat: 42.42, lon: -8.79, alt: 10 },
  { id: 'd', lat: 42.39, lon: -8.82, alt: 40 },
  { id: 'e', lat: 42.40, lon: -8.78, alt: 25 },
  { id: 'cape', lat: 42.41, lon: -8.83, alt: 15 },
  { id: 'hill', lat: 42.40, lon: -8.79, alt: 600 },
];

/** A night's mean per station: some day-to-day wobble, deterministic. */
function nights(
  override: (id: string, night: string, i: number) => Partial<Pick<NightMean, 'wind' | 'temp'>> = () => ({}),
): NightMean[] {
  const out: NightMean[] = [];
  NIGHTS.forEach((night, i) => {
    const wobble = Math.sin(i * 1.7) * 0.4;
    for (const st of STATIONS) {
      const base: NightMean = {
        stationId: st.id, night,
        wind: (st.id === 'cape' ? 6 : 2) + wobble + (st.id.charCodeAt(0) % 3) * 0.1,
        temp: 15 + wobble + (st.id.charCodeAt(0) % 3) * 0.2 - (st.id === 'hill' ? 3 : 0),
      };
      out.push({ ...base, ...override(st.id, night, i) });
    }
  });
  return out;
}

describe('changePointStrikes', () => {
  it('a quiet network gives nothing, and the cape station that always reads 3x is fine', () => {
    expect(changePointStrikes(STATIONS, nights(), LAST)).toEqual([]);
  });

  it('an anemometer that jumps to many times its neighbours fails that night (nt_1c4a68 on 28-sep)', () => {
    const s = changePointStrikes(STATIONS, nights((id, night) => (id === 'b' && night === LAST ? { wind: 25 } : {})), LAST);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ day: LAST, stationId: 'b', variable: 'wind', rule: 'cambio brusco' });
    expect(s[0].detail).toMatch(/viento de noche .*x la mediana de sus \d vecinas/);
  });

  it('a thermometer frozen at a warm value fails on temperature', () => {
    const s = changePointStrikes(STATIONS, nights((id, night) => (id === 'c' && night === LAST ? { temp: 19.5 } : {})), LAST);
    expect(s.map((x) => [x.stationId, x.variable])).toEqual([['c', 'temperature']]);
    expect(s[0].detail).toMatch(/temperatura de noche \+\d/);
  });

  it('a front that cools most stations the same night is weather: nobody fails', () => {
    // Every low station jumps; with this small network that is 6 of them (>= 6 and >= 3 %).
    const cold = new Set(['a', 'b', 'c', 'd', 'e', 'cape']);
    const s = changePointStrikes(
      [...STATIONS, ...Array.from({ length: 4 }, (_, k) => ({ id: `x${k}`, lat: 42.40 + k * 0.004, lon: -8.80, alt: 20 }))],
      nights((id, night, i) => (cold.has(id) && night === LAST ? { temp: 15 - 4 * (id.charCodeAt(0) % 2 ? 1 : -1) } : {}))
        .concat(NIGHTS.flatMap((night, i) => Array.from({ length: 4 }, (_, k) => ({ stationId: `x${k}`, night, wind: 2, temp: 15 + Math.sin(i * 1.7) * 0.4 })))),
      LAST,
    );
    expect(s.filter((x) => x.variable === 'temperature')).toEqual([]);
  });

  it('without 15 nights of its own baseline, a station is not judged', () => {
    const recent = nights().filter((m) => !(m.stationId === 'b' && m.night < NIGHTS[20]));
    const s = changePointStrikes(STATIONS, recent.map((m) => (m.stationId === 'b' && m.night === LAST ? { ...m, wind: 25 } : m)), LAST);
    expect(s.some((x) => x.stationId === 'b')).toBe(false);
  });

  it('with fewer than 3 neighbours reporting that night, nobody is judged', () => {
    const sparse = nights().filter((m) => !(m.night === LAST && ['a', 'c', 'd', 'e', 'cape'].includes(m.stationId)));
    const s = changePointStrikes(STATIONS, sparse.map((m) => (m.stationId === 'b' && m.night === LAST ? { ...m, wind: 25 } : m)), LAST);
    expect(s).toEqual([]);
  });

  it('neighbours are close AND at a similar height: the hill station is nobody\'s neighbour', () => {
    const near = cpNeighbours(STATIONS);
    expect(near.get('a')).not.toContain('hill');
    expect(near.get('hill')).toEqual([]);
    expect(near.get('a')).toEqual(expect.arrayContaining(['b', 'c', 'd', 'e', 'cape']));
  });
});
