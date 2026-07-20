import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseMetarVisibilityKm,
  metarToVisibilityReadings,
  fetchMetarVisibility,
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
