import { describe, it, expect } from 'vitest';
import {
  assessStrongWind, windAlertDue, formatWindSafetyMessage, episodesFromSends, reopenFromHistory, windLogDue, windLogState, WIND_LOG_HEARTBEAT_MS,
  WIND_EPISODE_GAP_MS, type SafetySpot,
} from './windSafetyLogic';
import type { BuoyWind, StationReading } from './analyzerLogic';

const KT = 1 / 1.94384; // kt → m/s, the unit the rows arrive in
const NOW = Date.UTC(2026, 8, 29, 9, 0);
const recent = new Date(NOW - 10 * 60_000);

const SPOTS: SafetySpot[] = [
  { id: 'lanzada', name: 'A Lanzada', lat: 42.4493, lon: -8.8795, sector: 'rias' },
  { id: 'surf-lanzada', name: 'Lanzada Surf', lat: 42.448, lon: -8.876, sector: 'rias' },
  { id: 'limens', name: 'Liméns', lat: 42.2575, lon: -8.8143, sector: 'rias' },
  { id: 'castrelo', name: 'Castrelo', lat: 42.2991, lon: -8.1087, sector: 'embalse' },
];

function station(name: string, lat: number, lon: number, meanKt: number, gustKt: number, extra: Partial<StationReading> = {}): StationReading {
  return {
    station_id: `mg_${name}`, name, latitude: lat, longitude: lon, altitude: 20, time: recent,
    wind_speed: meanKt * KT, wind_gust: gustKt * KT, wind_dir: 190, temperature: 18, humidity: 90, ...extra,
  };
}

function buoy(id: number, name: string, lat: number, lon: number, meanKt: number, gustKt: number): BuoyWind {
  return { station_id: id, station_name: name, lat, lon, time: recent, wind_speed: meanKt * KT, wind_gust: gustKt * KT, wind_dir: 190 };
}

const rias = (readings: StationReading[], buoys: BuoyWind[] = []) =>
  assessStrongWind(SPOTS, readings, buoys, NOW).find((a) => a.sector === 'rias')!;

describe('assessStrongWind — measured gusts, two sources, near a spot', () => {
  it('the front of 29-sep: Ons and Cabo Udra with 44 kt gusts is PELIGRO, and names the spots nearby', () => {
    const a = rias(
      [station('Ons', 42.38, -8.93, 29, 44), station('Cabo Udra', 42.34, -8.83, 28, 44)],
      [buoy(4272, 'Ons', 42.38, -8.94, 29, 43)],
    );
    expect(a.level).toBe('peligro');
    expect(a.evidence.map((e) => e.name)).toEqual(['Ons', 'Cabo Udra', 'Boya Ons']);
    expect(a.spots).toContain('A Lanzada');
    expect(a.spots).toContain('Liméns');
    expect(a.spots).not.toContain('Lanzada Surf'); // same place, named once
  });

  it('two sources with 35-39 kt gusts is AVISO', () => {
    expect(rias([station('Ons', 42.38, -8.93, 24, 36), station('Cabo Udra', 42.34, -8.83, 22, 37)]).level).toBe('aviso');
  });

  it('one source is never enough, however strong', () => {
    const a = rias([station('Ons', 42.38, -8.93, 30, 45)]);
    expect(a.level).toBeNull();
    expect(a.evidence).toHaveLength(1);
  });

  it('a spike inside a weak mean does not count (wu_IMARN3, 39 kt gust in a 4 kt mean)', () => {
    const a = rias([station('Ons', 42.38, -8.93, 30, 45), station('Marin WU', 42.40, -8.70, 3.9, 39)]);
    expect(a.level).toBeNull();
  });

  it('a mountain station, or one of unknown altitude, measures the mountain, not the water', () => {
    expect(rias([station('Ons', 42.38, -8.93, 30, 45), station('Monte', 42.33, -8.80, 30, 44, { altitude: 600 })]).level).toBeNull();
    expect(rias([station('Ons', 42.38, -8.93, 30, 45), station('Sin cota', 42.33, -8.80, 30, 44, { altitude: null })]).level).toBeNull();
  });

  it('stale readings and sources far from every spot are left out', () => {
    const old = new Date(NOW - 120 * 60_000);
    expect(rias([station('Ons', 42.38, -8.93, 30, 45), station('Udra', 42.34, -8.83, 30, 44, { time: old })]).level).toBeNull();
    expect(rias([station('Ons', 42.38, -8.93, 30, 45), station('Lejos', 42.90, -9.30, 30, 44)]).level).toBeNull();
  });

  it('each sector is judged by its own spots', () => {
    const all = assessStrongWind(SPOTS, [station('Ons', 42.38, -8.93, 30, 45), station('Cabo Udra', 42.34, -8.83, 28, 44)], [], NOW);
    expect(all.find((a) => a.sector === 'embalse')!.level).toBeNull();
  });
});

describe('windAlertDue — one message per episode, one more if it escalates', () => {
  it('announces the start, stays quiet while it lasts, speaks again on escalation', () => {
    const first = windAlertDue(undefined, 'aviso', NOW);
    expect(first.due).toBe(true);
    first.episode!.sentLevel = 'aviso'; // the caller records it after a successful send
    const again = windAlertDue(first.episode, 'aviso', NOW + 5 * 60_000);
    expect(again.due).toBe(false);
    expect(windAlertDue(again.episode, 'peligro', NOW + 10 * 60_000).due).toBe(true);
  });

  it('a send that did not happen (night silence) is retried on the next cycle', () => {
    const night = windAlertDue(undefined, 'peligro', NOW);
    expect(night.due).toBe(true); // nothing recorded as sent
    expect(windAlertDue(night.episode, 'peligro', NOW + 5 * 60_000).due).toBe(true);
  });

  it('after two quiet hours the episode is over and a new one is announced again', () => {
    const ep = { sentLevel: 'peligro' as const, lastActiveMs: NOW };
    expect(windAlertDue(ep, null, NOW + 30 * 60_000).episode).toBe(ep);
    expect(windAlertDue(ep, null, NOW + WIND_EPISODE_GAP_MS + 60_000).episode).toBeUndefined();
    expect(windAlertDue(ep, 'aviso', NOW + WIND_EPISODE_GAP_MS + 60_000).due).toBe(true);
  });
});

describe('formatWindSafetyMessage', () => {
  it('gives the measured figures with their source, and only the danger level carries advice', () => {
    const a = rias([station('Ons', 42.38, -8.93, 29, 44), station('Cabo Udra', 42.34, -8.83, 28, 44)]);
    const { title, message } = formatWindSafetyMessage(a);
    expect(title).toBe('VIENTO MUY FUERTE — Rías Baixas');
    expect(message).toContain('Ons: rachas 44 kt (media 29)');
    expect(message).toContain('Condiciones peligrosas');
    const aviso = formatWindSafetyMessage(rias([station('Ons', 42.38, -8.93, 24, 36), station('Cabo Udra', 42.34, -8.83, 22, 37)]));
    expect(aviso.title).toBe('Viento fuerte — Rías Baixas');
    expect(aviso.message).not.toContain('Condiciones peligrosas');
    // Informs, never authorises
    expect(`${message} ${aviso.message}`).not.toMatch(/puedes|permitido|apto|v[ií]a libre|sal a navegar/i);
  });
});

describe('assessStrongWind — names the most exposed spots first (first live alert, 29-sep)', () => {
  it('orders the spots by the strongest gust near them, not by config order', () => {
    const spots: SafetySpot[] = [
      { id: 'bocana', name: 'Bocana', lat: 42.265, lon: -8.7, sector: 'rias' },
      { id: 'lanzada', name: 'A Lanzada', lat: 42.4493, lon: -8.8795, sector: 'rias' },
    ];
    const a = assessStrongWind(spots, [
      station('Cangas-Porto', 42.26, -8.78, 21, 36),   // near Bocana
      station('A Lanzada', 42.45, -8.88, 31, 44),      // at A Lanzada
    ], [], NOW).find((x) => x.sector === 'rias')!;
    expect(a.spots).toEqual(['A Lanzada', 'Bocana']);
  });
});

describe('episodesFromSends — a restart in the middle of a gale does not announce it again', () => {
  it('reopens the episode of a recent send, ignores old ones and other alerts', () => {
    const eps = episodesFromSends([
      { key: 'wind:rias', atMs: NOW - 20 * 60_000, level: 'peligro' },
      { key: 'wind:embalse', atMs: NOW - WIND_EPISODE_GAP_MS - 60_000, level: 'aviso' },
      { key: 'spot:cies-ria', atMs: NOW - 5 * 60_000, level: 'moderate' },
    ], NOW);
    expect([...eps.keys()]).toEqual(['rias']);
    expect(windAlertDue(eps.get('rias'), 'peligro', NOW).due).toBe(false);
    expect(windAlertDue(eps.get('embalse'), 'aviso', NOW).due).toBe(true);
  });
});

describe('reopenFromHistory — a gale announced hours ago that is still blowing is not announced again', () => {
  const H = 60 * 60_000;
  const at = (ms: number) => new Date(ms);
  const sends = [{ key: 'wind:rias', atMs: NOW - 4.5 * H, level: 'peligro' }];
  const gale = (t: number) => [
    station('Ons', 42.38, -8.93, 30, 46, { time: at(t) }),
    station('Cabo Udra', 42.34, -8.83, 33, 42, { time: at(t) }),
  ];
  const calm = (t: number) => [
    station('Ons', 42.38, -8.93, 12, 18, { time: at(t) }),
    station('Cabo Udra', 42.34, -8.83, 10, 16, { time: at(t) }),
  ];

  it('29-sep: announced at 12:06, still 44-49 kt at the 16:41 restart → the episode stays open, no resend', () => {
    const eps = reopenFromHistory(sends, new Set(), SPOTS, [...gale(NOW - 3 * H), ...gale(NOW - 10 * 60_000)], [], NOW);
    expect(eps.get('rias')?.sentLevel).toBe('peligro');
    expect(windAlertDue(eps.get('rias'), 'peligro', NOW).due).toBe(false);
  });

  it('the wind stopped for the whole gap → no episode, a new gale is announced', () => {
    const eps = reopenFromHistory(sends, new Set(), SPOTS, [...gale(NOW - 4 * H), ...calm(NOW - 150 * 60_000), ...calm(NOW - 10 * 60_000)], [], NOW);
    expect(eps.size).toBe(0);
    expect(windAlertDue(eps.get('rias'), 'peligro', NOW).due).toBe(true);
  });

  it('the episode ends at the last step the replay saw the gale, with the latest row of each source', () => {
    const eps = reopenFromHistory(sends, new Set(), SPOTS, [...gale(NOW - 95 * 60_000), ...calm(NOW - 25 * 60_000)], [], NOW);
    const ep = eps.get('rias')!;
    expect(NOW - ep.lastActiveMs).toBe(30 * 60_000);   // steps of 10 min: the calm rows take over at -25 min
  });

  it('leaves alone a sector already reopened, other alerts and sends older than a day', () => {
    const readings = gale(NOW - 10 * 60_000);
    expect(reopenFromHistory(sends, new Set(['rias']), SPOTS, readings, [], NOW).size).toBe(0);
    expect(reopenFromHistory([{ key: 'spot:cies-ria', atMs: NOW - 3 * H, level: 'moderate' }], new Set(), SPOTS, readings, [], NOW).size).toBe(0);
    expect(reopenFromHistory([{ key: 'wind:rias', atMs: NOW - 25 * H, level: 'peligro' }], new Set(), SPOTS, readings, [], NOW).size).toBe(0);
  });
});

describe('windLogDue — the state line is written when it changes, not every cycle (29-sep)', () => {
  it('writes on a change of level, then only the hourly heartbeat while it holds', () => {
    const t0 = NOW;
    expect(windLogDue(undefined, 'peligro', t0)).toBe(true);
    const prev = { state: 'peligro', atMs: t0 };
    expect(windLogDue(prev, 'peligro', t0 + 5 * 60_000)).toBe(false);   // figures moved, same level
    expect(windLogDue(prev, 'aviso', t0 + 10 * 60_000)).toBe(true);
    expect(windLogDue(prev, 'peligro', t0 + WIND_LOG_HEARTBEAT_MS)).toBe(true);
  });

  it('says nothing on a calm start, and says once that it went calm', () => {
    expect(windLogDue(undefined, 'sin rachas fuertes', NOW)).toBe(false);
    expect(windLogDue({ state: 'aviso', atMs: NOW }, 'sin rachas fuertes', NOW + 5 * 60_000)).toBe(true);
    expect(windLogDue({ state: 'sin rachas fuertes', atMs: NOW }, 'sin rachas fuertes', NOW + 2 * WIND_LOG_HEARTBEAT_MS)).toBe(false);
  });

  it('the state is the level, or whether there is anything uncorroborated', () => {
    expect(windLogState({ level: 'peligro', evidence: [] })).toBe('peligro');
    expect(windLogState({ level: null, evidence: [{ name: 'Ons', meanKt: 30, gustKt: 45, lat: 0, lon: 0 }] })).toBe('sin corroborar');
    expect(windLogState({ level: null, evidence: [] })).toBe('sin rachas fuertes');
  });
});
