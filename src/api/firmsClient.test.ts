/**
 * The map reads the hotspots our server stores (21-oct audit, finding 13); the live FIRMS proxy
 * is only the fallback for when the database cannot answer.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchActiveFires, parsePgTimestamp, storedFireToActive } from './firmsClient';
import type { FireWithAttribution } from '../types/fire';

const STORED: FireWithAttribution = {
  time: '2026-06-25 02:18:00+00',
  lat: 42.12345,
  lon: -7.98765,
  satellite: 'N20',
  frp: 12.5,
  confidence: 'nominal',
  daynight: 'N',
  strikeCount: 0,
  hoursAfterStrike: null,
  nearestStrikeKm: null,
  maxStrikeKa: null,
};

const CSV = [
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
  '42.5,-8.1,340.2,0.4,0.4,2026-06-25,1342,N,VIIRS,n,2.0NRT,290.1,8.2,D',
].join('\n');

afterEach(() => vi.unstubAllGlobals());

describe('parsePgTimestamp', () => {
  it('reads the timestamptz text Postgres prints, in any zone, and ISO', () => {
    expect(parsePgTimestamp('2026-06-25 02:18:00+00')).toBe(Date.parse('2026-06-25T02:18:00Z'));
    expect(parsePgTimestamp('2026-06-25 04:18:00+02')).toBe(Date.parse('2026-06-25T02:18:00Z'));
    expect(parsePgTimestamp('2026-06-25 04:18:00.5+02:00')).toBe(Date.parse('2026-06-25T02:18:00.500Z'));
    expect(parsePgTimestamp('2026-06-25T02:18:00Z')).toBe(Date.parse('2026-06-25T02:18:00Z'));
    expect(Number.isNaN(parsePgTimestamp('nonsense'))).toBe(true);
  });
});

describe('storedFireToActive', () => {
  it('builds the same hotspot the CSV parser would, id included', () => {
    expect(storedFireToActive(STORED)).toEqual({
      id: '42.12345_-7.98765_2026-06-25_0218',
      lat: 42.12345,
      lon: -7.98765,
      brightness: 0,
      frp: 12.5,
      acquiredAt: new Date('2026-06-25T02:18:00Z'),
      satellite: 'N20',
      confidence: 'nominal',
      daynight: 'N',
    });
  });

  it('drops a row without a usable time', () => {
    expect(storedFireToActive({ ...STORED, time: '' })).toBeNull();
  });
});

describe('fetchActiveFires', () => {
  it('takes the stored hotspots and never asks the live proxy when the database answers', async () => {
    const f = vi.fn(async (url: string) =>
      url.startsWith('/api/v1/fires')
        ? new Response(JSON.stringify({ days: 1, count: 1, fires: [STORED] }), { status: 200 })
        : new Response(CSV, { status: 200 }));
    vi.stubGlobal('fetch', f);
    const r = await fetchActiveFires(1);
    expect(r.fromCache).toBe('stored');
    expect(r.fires.map((x) => x.id)).toEqual(['42.12345_-7.98765_2026-06-25_0218']);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('/api/v1/fires?days=1');
  });

  it('no fires stored is an answer: it does not go to NASA for a second opinion', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ days: 1, count: 0, fires: [] }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect((await fetchActiveFires(1)).fires).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('with the database down it falls back to the live proxy', async () => {
    const f = vi.fn(async (url: string) =>
      url.startsWith('/api/v1/fires')
        ? new Response('{"error":"x"}', { status: 500 })
        : new Response(CSV, { status: 200, headers: { 'x-cache': 'HIT' } }));
    vi.stubGlobal('fetch', f);
    const r = await fetchActiveFires(1);
    expect(f.mock.calls.map((c) => c[0])).toEqual(['/api/v1/fires?days=1', '/api/v1/firms?days=1']);
    expect(r.fromCache).toBe('hit');
    expect(r.fires).toHaveLength(1);
  });
});
