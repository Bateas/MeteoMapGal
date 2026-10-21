import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseMetarVisibilityKm,
  metarToVisibilityReadings,
  metarPrecipWithoutFog,
  fetchMetarVisibility,
  storedMetarToVisibilityReadings,
  storedMetarIsCurrent,
  STORED_METAR_MAX_AGE_MS,
  type MetarEntry,
} from './metarClient';

// Real LEVX sample captured live from
// https://aviationweather.gov/api/data/metar?ids=LEVX,LEST,LECO&format=json
const LEVX_FIXTURE: MetarEntry = {
  icaoId: 'LEVX',
  obsTime: 1784586600,
  visib: '6+',
  rawOb: 'METAR LEVX 202230Z 36003KT 320V040 9999 OVC026 21/16 Q1018 NOSIG',
  lat: 42.239,
  lon: -8.624,
  name: 'Vigo/Peinador Arpt',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseMetarVisibilityKm', () => {
  it('maps the "N+" suffix to the 10km reporting cap', () => {
    expect(parseMetarVisibilityKm('6+')).toBe(10);
    expect(parseMetarVisibilityKm('10+')).toBe(10);
  });

  it('converts numeric statute miles to km rounded to 1 decimal', () => {
    // 3.5 SM x 1.609 = 5.6315 → 5.6
    expect(parseMetarVisibilityKm('3.5')).toBe(5.6);
    // number type must also be accepted (API is inconsistent)
    expect(parseMetarVisibilityKm(2)).toBe(3.2);
  });

  it('keeps fog visibilities below 1 km to the tens of metres (15-oct: Peinador 0050 read as 0 m)', () => {
    // METAR LEVX 150600Z ... 0050 ... FG: aviationweather gives visib 0.03 SM
    expect(parseMetarVisibilityKm(0.03)).toBe(0.05);
    expect(parseMetarVisibilityKm('0.06')).toBe(0.1);
    expect(parseMetarVisibilityKm('0.5')).toBe(0.8);
  });

  it('falls back to the rawOb 9999 group only when visib is absent', () => {
    expect(parseMetarVisibilityKm(undefined, LEVX_FIXTURE.rawOb)).toBe(10);
    // explicit garbage visib must NOT fall through to rawOb
    expect(parseMetarVisibilityKm('CAVOK', LEVX_FIXTURE.rawOb)).toBeNull();
  });

  it('discards unparseable or absurd values instead of inventing', () => {
    expect(parseMetarVisibilityKm('CAVOK')).toBeNull();
    expect(parseMetarVisibilityKm(undefined, 'METAR LEVX 202230Z 36003KT 4000 BR')).toBeNull();
    expect(parseMetarVisibilityKm(-1)).toBeNull();
    // 99 SM = ~159km — beyond the sanity ceiling shared with the AEMET writer
    expect(parseMetarVisibilityKm('99')).toBeNull();
    expect(parseMetarVisibilityKm(undefined)).toBeNull();
  });
});

describe('metarPrecipWithoutFog — low visibility in rain is not fog (6-oct)', () => {
  it('heavy thunderstorm rain at Santiago (0.8 km) is precipitation, not fog', () => {
    expect(metarPrecipWithoutFog('METAR LEST 060916Z 22006KT 0800 +TSRA SCT010 SCT030 BKN045CB 16/14 Q1012')).toBe(true);
    expect(metarPrecipWithoutFog('METAR LEVX 061000Z 22007KT 6000 -SHRA FEW012 16/14 Q1013')).toBe(true);
  });
  it('fog or mist with the rain, vicinity, recent or trend weather keep it a fog candidate', () => {
    expect(metarPrecipWithoutFog('METAR LEVX 060600Z 00000KT 0300 -DZ FG VV001 14/14 Q1015')).toBe(false);
    expect(metarPrecipWithoutFog('METAR LEVX 060600Z 00000KT 0800 -RA BR OVC002 14/14 Q1015')).toBe(false);
    expect(metarPrecipWithoutFog('METAR LEVX 060800Z 22002KT 9999 VCTS SCT050 17/14 Q1013')).toBe(false);
    expect(metarPrecipWithoutFog('METAR LEVX 060600Z 00000KT 0200 FG VV001 14/14 Q1015 RETSRA')).toBe(false);
    expect(metarPrecipWithoutFog('METAR LEVX 060600Z 00000KT 0200 FG VV001 14/14 Q1015 TEMPO 3000 SHRA')).toBe(false);
    expect(metarPrecipWithoutFog(undefined)).toBe(false);
  });
  it('the reading carries the flag only when it applies', () => {
    const rain = metarToVisibilityReadings([{ ...LEVX_FIXTURE, visib: '0.5', rawOb: 'METAR LEVX 061100Z 22012KT 0800 +TSRA BKN010CB 16/15 Q1011' }]);
    expect(rain[0].precipitating).toBe(true);
    expect(metarToVisibilityReadings([LEVX_FIXTURE])[0]).not.toHaveProperty('precipitating');
  });
});

describe('metarToVisibilityReadings', () => {
  it('maps the real LEVX sample to the VisibilityReading shape', () => {
    const out = metarToVisibilityReadings([LEVX_FIXTURE]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      stationId: 'metar_LEVX',
      name: 'Vigo/Peinador (METAR)',
      lat: 42.239,
      lon: -8.624,
      visibility: 10,
      timestamp: new Date(1784586600 * 1000), // obsTime is epoch SECONDS
    });
  });

  it('converts obsTime epoch seconds to a Date in milliseconds', () => {
    const out = metarToVisibilityReadings([LEVX_FIXTURE]);
    expect(out[0].timestamp.getTime()).toBe(1784586600000);
    expect(out[0].timestamp.toISOString()).toBe('2026-07-20T22:30:00.000Z');
  });

  it('drops stations with unparseable visibility, keeping the rest', () => {
    const broken: MetarEntry = { ...LEVX_FIXTURE, icaoId: 'LEST', visib: 'CAVOK', rawOb: 'METAR LEST 202230Z 4000 BR' };
    const out = metarToVisibilityReadings([LEVX_FIXTURE, broken]);
    expect(out.map((r) => r.stationId)).toEqual(['metar_LEVX']);
  });

  it('drops stations missing coords or timestamp (never half-filled)', () => {
    const noCoords: MetarEntry = { ...LEVX_FIXTURE, lat: undefined };
    const noTime: MetarEntry = { ...LEVX_FIXTURE, obsTime: undefined };
    expect(metarToVisibilityReadings([noCoords, noTime])).toEqual([]);
  });

  it('keeps only the newest reading when a station is duplicated', () => {
    const older: MetarEntry = { ...LEVX_FIXTURE, obsTime: 1784586600 - 1800, visib: '2' };
    const out = metarToVisibilityReadings([older, LEVX_FIXTURE]);
    expect(out).toHaveLength(1);
    expect(out[0].visibility).toBe(10);
  });

  it('returns [] for non-array or malformed payloads', () => {
    expect(metarToVisibilityReadings(null)).toEqual([]);
    expect(metarToVisibilityReadings({ error: 'nope' })).toEqual([]);
    expect(metarToVisibilityReadings([null, 42, 'x'])).toEqual([]);
  });

  it('labels unknown ICAO ids without inventing a Spanish name', () => {
    const out = metarToVisibilityReadings([{ ...LEVX_FIXTURE, icaoId: 'LEMD' }]);
    expect(out[0].stationId).toBe('metar_LEMD');
    expect(out[0].name).toBe('LEMD (METAR)');
  });
});

describe('fetchMetarVisibility', () => {
  it('returns parsed readings on a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [LEVX_FIXTURE],
    }));
    const out = await fetchMetarVisibility();
    expect(out).toHaveLength(1);
    expect(out[0].stationId).toBe('metar_LEVX');
  });

  it('degrades to [] on network error without throwing', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchMetarVisibility()).resolves.toEqual([]);
    expect(debugSpy).toHaveBeenCalled();
  });

  it('degrades to [] on HTTP errors (dev proxy 404 before deploy)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    }));
    await expect(fetchMetarVisibility()).resolves.toEqual([]);
  });
});

describe('stored METAR first (21-oct audit, finding 14)', () => {
  const now = Date.parse('2026-10-21T09:20:00Z');
  const stored = (ageMin: number, icaos = ['LEVX', 'LEST', 'LECO']) => ({
    reports: icaos.map((icao) => ({
      icao, obsTime: now - ageMin * 60_000, visibilityKm: icao === 'LEVX' ? 0.4 : 10,
      rawOb: `METAR ${icao} 210900Z 00000KT ${icao === 'LEVX' ? '0400 FG' : 'CAVOK'} 12/12 Q1020`,
    })),
  });
  const route = (storedBody: unknown, storedOk = true) => vi.fn(async (url: string) => {
    if (url === '/api/v1/metar/latest') {
      return { ok: storedOk, status: storedOk ? 200 : 500, json: async () => storedBody };
    }
    return { ok: true, status: 200, json: async () => [{ ...LEVX_FIXTURE, obsTime: Math.floor(now / 1000) }] };
  });

  it('reads the stored report as the live one: position, km, fog, time', () => {
    const [levx] = storedMetarToVisibilityReadings(stored(10, ['LEVX']));
    expect(levx).toMatchObject({ stationId: 'metar_LEVX', name: 'Vigo/Peinador (METAR)', lat: 42.239, lon: -8.624, visibility: 0.4 });
    expect(levx.timestamp.getTime()).toBe(now - 10 * 60_000);
    expect(levx.precipitating).toBeUndefined();
  });

  it('drops an airport it cannot place or without a visibility', () => {
    expect(storedMetarToVisibilityReadings({ reports: [{ icao: 'LEMD', obsTime: now, visibilityKm: 10, rawOb: 'x' }] })).toEqual([]);
    expect(storedMetarToVisibilityReadings({ reports: [{ icao: 'LEVX', obsTime: now, visibilityKm: null, rawOb: 'x' }] })).toEqual([]);
    expect(storedMetarToVisibilityReadings([LEVX_FIXTURE])).toEqual([]);
  });

  it('current = the three airports, none older than the limit', () => {
    expect(storedMetarIsCurrent(storedMetarToVisibilityReadings(stored(20)), now)).toBe(true);
    expect(storedMetarIsCurrent(storedMetarToVisibilityReadings(stored(STORED_METAR_MAX_AGE_MS / 60_000 + 1)), now)).toBe(false);
    expect(storedMetarIsCurrent(storedMetarToVisibilityReadings(stored(5, ['LEVX', 'LEST'])), now)).toBe(false);
  });

  it('with current stored reports the live proxy is not asked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const f = route(stored(20));
    vi.stubGlobal('fetch', f);
    const out = await fetchMetarVisibility();
    vi.useRealTimers();
    expect(out).toHaveLength(3);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('with old stored reports it asks the proxy and keeps the newer per airport', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const f = route(stored(70));
    vi.stubGlobal('fetch', f);
    const out = await fetchMetarVisibility();
    vi.useRealTimers();
    expect(f).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(3);
    expect(out.find((r) => r.stationId === 'metar_LEVX')?.timestamp.getTime()).toBe(Math.floor(now / 1000) * 1000);
    expect(out.find((r) => r.stationId === 'metar_LEST')?.timestamp.getTime()).toBe(now - 70 * 60_000);
  });

  it('without our endpoint (database down) it goes to the proxy alone', async () => {
    const f = route(null, false);
    vi.stubGlobal('fetch', f);
    const out = await fetchMetarVisibility();
    expect(f).toHaveBeenCalledTimes(2);
    expect(out.map((r) => r.stationId)).toEqual(['metar_LEVX']);
  });
});
