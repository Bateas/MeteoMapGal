/**
 * Tests for ingestor/lightningFetcher — pure parser & mapping of MeteoGalicia's official
 * lightning JSON (jsonRaios.action).
 *
 * The fetch + DB write paths are covered by integration in production
 * (deduplication is enforced by the PK constraint, not the test). Here
 * we lock the parser behavior so the wire format can't regress silently.
 */

import { describe, it, expect } from 'vitest';
import { parseJsonRaios, toPersisted, isInGaliciaScope, feedSilentNotice } from './lightningFetcher';

// ── parseJsonRaios ───────────────────────────────────

describe('parseJsonRaios', () => {
  it('reads each strike with its UTC time to the second (real body of 7-oct-2026)', () => {
    const body = {
      raios: [{
        data: '2026-10-07T00:00:00',
        listaRaios: [
          { fecha: '2026-10-07T01:46:13', lat: 45.127, lon: -1.4622, peakCurrent: -139 },
          { fecha: '2026-10-07T01:51:46', lat: 43.7784, lon: -6.6218, peakCurrent: -14 },
          { fecha: 'mal', lat: 43, lon: -8, peakCurrent: 5 },
        ],
        numRaiosGalicia: 0,
        numRaiosTotal: 3,
      }],
    };
    const strikes = parseJsonRaios(body)!;
    expect(strikes).toHaveLength(2);
    expect(strikes[1].time.toISOString()).toBe('2026-10-07T01:51:46.000Z');
    expect(strikes[1]).toMatchObject({ lat: 43.7784, lon: -6.6218, peakCurrent: -14 });
  });

  it('reads every day of a range answer (one element per day)', () => {
    const body = {
      raios: [
        { data: '2026-10-11T00:00:00', listaRaios: [{ fecha: '2026-10-11T23:58:10', lat: 42.3, lon: -8.6, peakCurrent: 12 }] },
        { data: '2026-10-12T00:00:00', listaRaios: [{ fecha: '2026-10-12T00:01:02', lat: 42.31, lon: -8.61, peakCurrent: -8 }] },
      ],
    };
    expect(parseJsonRaios(body)!.map((s) => s.time.toISOString())).toEqual(['2026-10-11T23:58:10.000Z', '2026-10-12T00:01:02.000Z']);
  });

  it('a quiet day is an empty list, not a failure (real body of 26-nov-2026)', () => {
    const quiet = { raios: [{ data: '2026-11-26T00:00:00', listaRaios: [], numRaiosGalicia: 0, numRaiosTotal: 0 }] };
    expect(parseJsonRaios(quiet)).toEqual([]);
  });

  it('a body without the list of strikes is a failure (null), never «no strikes», and never a throw', () => {
    expect(parseJsonRaios({})).toBeNull();
    expect(parseJsonRaios(null)).toBeNull();
    expect(parseJsonRaios({ raios: null })).toBeNull();
    expect(parseJsonRaios({ raios: 'x' })).toBeNull();
    expect(parseJsonRaios({ raios: [] })).toBeNull();
    expect(parseJsonRaios({ raios: [null] })).toBeNull();
    expect(parseJsonRaios({ raios: [{ data: '2026-10-08T00:00:00', listaRaios: null }] })).toBeNull();
    // One good day does not hide a broken one.
    expect(parseJsonRaios({ raios: [{ listaRaios: [] }, { data: '2026-10-08T00:00:00' }] })).toBeNull();
  });

  it('inside a good list, a strike without valid time or position is dropped', () => {
    expect(parseJsonRaios({ raios: [{ listaRaios: [null, { fecha: '2026-10-08T10:00:00', lat: 'x', lon: -8 }] }] })).toEqual([]);
  });

  it('a strike without current keeps its position (current null)', () => {
    const [s] = parseJsonRaios({ raios: [{ listaRaios: [{ fecha: '2026-10-08T10:00:00', lat: 42, lon: -8 }] }] })!;
    expect(s.peakCurrent).toBeNull();
  });
});

// ── feedSilentNotice ─────────────────────────────────

describe('feedSilentNotice — the owner hears when the lightning feed goes silent', () => {
  const min = 60_000;
  const t0 = Date.parse('2026-11-26T15:40:00Z'); // 16:40 in Madrid

  it('stays quiet under 20 minutes without a good answer', () => {
    expect(feedSilentNotice(t0 + 19 * min, t0, t0 - 60 * min)).toBeNull();
  });

  it('speaks from 20 minutes, with the time of the last good answer in Madrid', () => {
    const text = feedSilentNotice(t0 + 20 * min, t0, t0 - 60 * min);
    expect(text).toContain('desde las 16:40');
    expect(text).toContain('no ven rayos');
  });

  it('without any good answer since the start, counts from the start of the process', () => {
    expect(feedSilentNotice(t0 + 10 * min, null, t0)).toBeNull();
    expect(feedSilentNotice(t0 + 25 * min, null, t0)).toContain('desde que arrancó el ingestor, a las 16:40');
  });

  it('carries no Telegram formatting characters', () => {
    expect(feedSilentNotice(t0 + 30 * min, t0, t0)).not.toMatch(/[_*`[\]]/);
  });
});

// ── toPersisted ──────────────────────────────────────

describe('toPersisted', () => {
  it('keeps the signed current, marks ground strikes and the Galicia scope', () => {
    const rows = toPersisted([
      { time: new Date('2026-10-06T10:00:56Z'), lat: 42.24, lon: -8.72, peakCurrent: -65 },
      { time: new Date('2026-10-06T10:01:00Z'), lat: 40.72, lon: -7.58, peakCurrent: 18 },
    ]);
    expect(rows[0]).toEqual({
      time: new Date('2026-10-06T10:00:00Z'), lat: 42.24, lon: -8.72, peakCurrent: -65,
      cloudToCloud: false, multiplicity: 1, isGalicia: true,
    });
    expect(rows[1]).toMatchObject({ peakCurrent: 18, isGalicia: false });
  });

  it('stores the time to the minute, like every row before the switch (PK time, lat, lon)', () => {
    const [r] = toPersisted([{ time: new Date('2026-10-06T23:59:59Z'), lat: 42, lon: -8, peakCurrent: 5 }]);
    expect(r.time.toISOString()).toBe('2026-10-06T23:59:00.000Z');
  });

  it('a missing current is stored as 0, not dropped', () => {
    expect(toPersisted([{ time: new Date(0), lat: 42, lon: -8, peakCurrent: null }])[0].peakCurrent).toBe(0);
  });
});

// ── isInGaliciaScope ─────────────────────────────────

describe('isInGaliciaScope', () => {
  it('accepts central Galicia (Lugo)', () => {
    expect(isInGaliciaScope(42.59, -7.86)).toBe(true);
  });

  it('accepts Rías Baixas coast (Vigo)', () => {
    expect(isInGaliciaScope(42.24, -8.72)).toBe(true);
  });

  it('accepts Estaca de Bares north edge', () => {
    expect(isInGaliciaScope(43.79, -7.69)).toBe(true);
  });

  it('accepts offshore Atlantic within 100km buffer', () => {
    expect(isInGaliciaScope(42.5, -10.2)).toBe(true);
  });

  it('accepts northern Portugal (Porto/Aveiro)', () => {
    expect(isInGaliciaScope(41.6, -8.6)).toBe(true);
  });

  it('accepts Ourense + León border buffer (E -6.0)', () => {
    expect(isInGaliciaScope(42.1, -6.3)).toBe(true);
  });

  it('rejects Castilla interior (lon east of -6.0)', () => {
    expect(isInGaliciaScope(41.9, -5.5)).toBe(false);
  });

  it('rejects deep Portugal (lat south of 41.5)', () => {
    expect(isInGaliciaScope(40.8, -8.5)).toBe(false);
  });

  it('rejects Asturias/Cantabria (lat north of 44.5)', () => {
    expect(isInGaliciaScope(44.9, -6.5)).toBe(false);
  });

  it('rejects far Atlantic (lon west of -10.5)', () => {
    expect(isInGaliciaScope(42.5, -11.2)).toBe(false);
  });

  it('boundary: exactly on the edge is inclusive', () => {
    expect(isInGaliciaScope(44.5, -6.0)).toBe(true);
    expect(isInGaliciaScope(41.5, -10.5)).toBe(true);
  });
});
