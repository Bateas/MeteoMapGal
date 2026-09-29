import { describe, it, expect } from 'vitest';
import { detectStrikes, type HealthStation, type DayRow } from './healthDetectors';

const DAY = '2026-09-29';
const START = Date.parse('2026-09-29T00:00:00+02:00');
const END = Date.parse('2026-09-30T00:00:00+02:00');
const MIN = 60_000;
const VIGO = { lat: 42.24, lon: -8.72 };

/** A plausible autumn day every 10 minutes: mild, breezy, some sun, no rain. */
function day(over: (i: number, t: number) => Partial<DayRow> = () => ({})): DayRow[] {
  const rows: DayRow[] = [];
  for (let i = 0; i < 144; i++) {
    const t = START + i * 10 * MIN;
    const h = i / 6;
    const sun = Math.max(0, Math.sin(((h - 8) / 12) * Math.PI));
    rows.push({
      t,
      temperature: 15 + 5 * sun + 0.3 * Math.sin(i),
      humidity: 80 - 20 * sun + Math.round(2 * Math.cos(i)),
      windSpeed: 3 + 2 * sun + 0.5 * Math.sin(i / 3),
      windGust: 5 + 3 * sun,
      pressure: 1015 + 0.02 * i,
      precip: 0,
      solar: Math.round(650 * sun),
      ...over(i, t),
    });
  }
  return rows;
}

const at = (id: string, dLatKm: number, rows = day()): HealthStation => ({ id, lat: VIGO.lat + dLatKm / 111, lon: VIGO.lon, rows });
const rulesFor = (strikes: ReturnType<typeof detectStrikes>, id: string) => strikes.filter((s) => s.stationId === id).map((s) => `${s.variable}:${s.rule}`).sort();

describe('detectStrikes — a normal day raises nothing', () => {
  it('four healthy stations, no strikes', () => {
    const strikes = detectStrikes([at('mg_1', 0), at('mg_2', 3), at('mg_3', -4), at('wu_1', 5)], DAY, END);
    expect(strikes).toEqual([]);
  });
});

describe('detectStrikes — the failures of this network', () => {
  it('frozen outdoor unit (wu_IVIGO83): temperature, humidity, wind and sun stuck; the indoor barometer still moves', () => {
    const stuck = at('wu_IVIGO83', 0, day(() => ({ temperature: 29, humidity: 56, windSpeed: 2, solar: 720.7 })));
    const strikes = detectStrikes([stuck, at('mg_2', 3), at('mg_3', -4)], DAY, END);
    expect(rulesFor(strikes, 'wu_IVIGO83')).toEqual(['humidity:congelado', 'solar:congelado', 'solar:sol de noche', 'temperature:congelado', 'wind:congelado']);
  });

  it('frozen needs two neighbours that move: a twin on another network does not count', () => {
    const stuck = at('wu_A', 0, day(() => ({ temperature: 29 })));
    const twin = at('mc_A', 0.05);
    const strikes = detectStrikes([stuck, twin, at('mg_3', -4)], DAY, END);
    expect(rulesFor(strikes, 'wu_A')).toEqual([]);
  });

  it('Fontecada in the rain (29-sep): temperature spikes that come back', () => {
    const broken = at('mg_10087', 0, day((i) => (i === 10 ? { temperature: -16.1 } : i === 110 ? { temperature: -13.2 } : {})));
    expect(rulesFor(detectStrikes([broken], DAY, END), 'mg_10087')).toEqual(['temperature:picos']);
  });

  it('one spike in the day is a bad reading, not a bad sensor', () => {
    const once = at('mg_10087', 0, day((i) => (i === 10 ? { temperature: -16.1 } : {})));
    expect(rulesFor(detectStrikes([once], DAY, END), 'mg_10087')).toEqual([]);
  });

  it('humidity stuck at 99-100 % while the neighbours dry out', () => {
    const wet = at('wu_IPONTE102', 0, day((i) => ({ humidity: i % 2 ? 99 : 100 })));
    const strikes = detectStrikes([wet, at('mg_2', 3), at('mg_3', -4)], DAY, END);
    expect(rulesFor(strikes, 'wu_IPONTE102')).toEqual(['humidity:humedad clavada']);
  });

  it('a dry gauge between two wet neighbours within 6 km', () => {
    const rainy = (mmPerSlot: number) => (i: number) => ({ precip: i >= 60 && i < 72 ? mmPerSlot : 0 });
    const dry = at('mg_dry', 0);
    const strikes = detectStrikes([dry, at('mg_w1', 2, day(rainy(0.6))), at('mg_w2', -3, day(rainy(0.8)))], DAY, END);
    expect(rulesFor(strikes, 'mg_dry')).toEqual(['precipitation:pluviometro seco']);
  });

  it('a day counter that jumps tens of millimetres every few minutes (Nigrán, 29-sep)', () => {
    let total = 0;
    const counter = at('wu_INIGRN10', 0, day((i) => {
      if (i >= 90 && i < 110) total += 40;
      return { precip: total };
    }));
    expect(rulesFor(detectStrikes([counter], DAY, END), 'wu_INIGRN10')).toEqual(['precipitation:contador roto']);
  });

  it('sun at night, and a pyranometer dark at midday while the neighbours see the sun', () => {
    const lit = at('wu_lit', 0, day((i) => (i >= 138 ? { solar: 60 } : {})));
    const dark = at('wu_INOIA11', 1, day((i, t) => ({ solar: new Date(t).getUTCHours() >= 10 && new Date(t).getUTCHours() < 15 ? 40 : 0 })));
    const strikes = detectStrikes([lit, dark, at('mg_2', 3), at('mg_3', -4)], DAY, END);
    expect(rulesFor(strikes, 'wu_lit')).toEqual(['solar:sol de noche']);
    expect(rulesFor(strikes, 'wu_INOIA11')).toEqual(['solar:a oscuras']);
  });

  it('an anemometer with a mean of exactly zero and real gusts (wu_IMARN3)', () => {
    const cups = at('wu_IMARN3', 0, day((i) => ({ windSpeed: i % 10 === 0 ? 1 : 0, windGust: i % 12 === 0 ? 9 : 2 })));
    expect(rulesFor(detectStrikes([cups], DAY, END), 'wu_IMARN3')).toEqual(['wind:media a cero con rachas']);
  });

  it('a barometer 20 hPa below three neighbours', () => {
    const low = at('nt_low', 0, day((i) => ({ pressure: 995 + 0.02 * i })));
    const strikes = detectStrikes([low, at('mg_2', 3), at('mg_3', -4), at('mg_4', 8)], DAY, END);
    expect(rulesFor(strikes, 'nt_low')).toEqual(['pressure:presion desfasada']);
  });

  it('8 hPa off (an owner who typed the wrong altitude) is a calibration, not a broken barometer', () => {
    const off = at('nt_off', 0, day((i) => ({ pressure: 1007 + 0.02 * i })));
    const strikes = detectStrikes([off, at('mg_2', 3), at('mg_3', -4), at('mg_4', 8)], DAY, END);
    expect(rulesFor(strikes, 'nt_off')).toEqual([]);
  });

  it('a neighbour with a broken counter is not a wet neighbour', () => {
    const rainy = (i: number) => ({ precip: i >= 60 && i < 72 ? 0.6 : 0 });
    let total = 0;
    const counter = day((i) => { if (i >= 90 && i < 110) total += 90; return { precip: total }; });
    const strikes = detectStrikes([at('mg_dry', 0), at('mg_w1', 2, day(rainy)), at('wu_counter', -3, counter)], DAY, END);
    expect(rulesFor(strikes, 'mg_dry')).toEqual([]);
  });
});
