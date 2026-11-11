import { describe, it, expect } from 'vitest';
import {
  SHADOW_KEEPALIVE_MS, claimKey, decideWrites, describeCycle, markWritten, seenFromRows, tidyParams, toRow,
  type SeenState, type ShadowClaim,
} from './shadowClaimsLogic';

const T0 = Date.UTC(2026, 10, 11, 10, 0, 0);

function claim(over: Partial<ShadowClaim> = {}): ShadowClaim {
  return {
    type: 'shadow-fog-physics', sector: 'rias', state: 'none', score: 12.345,
    params: { humidity: 91.2345, waterTemp: 15 }, hypothesis: 'Sin riesgo', ...over,
  };
}

describe('claimKey', () => {
  it('separates type, sector and spot', () => {
    expect(claimKey({ type: 'shadow-rain-now', sector: 'rias', subject: 'cesantes' })).toBe('shadow-rain-now|rias|cesantes');
    expect(claimKey({ type: 'shadow-frost', sector: 'embalse' })).toBe('shadow-frost|embalse|');
    expect(claimKey({ type: 'shadow-frost', sector: 'embalse', subject: null })).toBe('shadow-frost|embalse|');
  });
});

describe('toRow', () => {
  it('puts the state in level and the inputs, reason and previous state in params', () => {
    const row = toRow(claim({ subject: 'vao', state: 'riesgo' }), 'cambio', 'none');
    expect(row).toEqual({
      alertType: 'shadow-fog-physics', sector: 'rias', level: 'riesgo', score: 12.35,
      params: { subject: 'vao', reason: 'cambio', prev: 'none', humidity: 91.23, waterTemp: 15 },
      hypothesis: 'Sin riesgo',
    });
  });

  it('leaves subject out for a sector answer and keeps a missing score as null', () => {
    const row = toRow(claim({ score: null }), 'inicio', null);
    expect(row.params).not.toHaveProperty('subject');
    expect(row.params.prev).toBeNull();
    expect(row.score).toBeNull();
    expect(toRow(claim({ score: NaN }), 'inicio', null).score).toBeNull();
  });
});

describe('tidyParams', () => {
  it('rounds numbers, turns dates into ISO and drops undefined', () => {
    const out = tidyParams({ a: 1.23456, b: new Date(T0), c: undefined, d: null, e: 'x', f: Infinity, g: false });
    expect(out).toEqual({ a: 1.23, b: '2026-11-11T10:00:00.000Z', d: null, e: 'x', f: null, g: false });
  });
});

describe('decideWrites', () => {
  it('writes the first answer of a key as «inicio»', () => {
    const { rows, changes } = decideWrites([claim()], new Map(), T0);
    expect(rows).toHaveLength(1);
    expect(rows[0].row.params.reason).toBe('inicio');
    expect(changes).toBe(0);
  });

  it('writes nothing while the state stays the same', () => {
    const seen = new Map<string, SeenState>([[claimKey(claim()), { state: 'none', writtenAt: T0 }]]);
    expect(decideWrites([claim()], seen, T0 + 60 * 60_000).rows).toHaveLength(0);
  });

  it('writes a change with the previous state', () => {
    const seen = new Map<string, SeenState>([[claimKey(claim()), { state: 'none', writtenAt: T0 }]]);
    const { rows, changes } = decideWrites([claim({ state: 'alto' })], seen, T0 + 10 * 60_000);
    expect(changes).toBe(1);
    expect(rows[0].row.level).toBe('alto');
    expect(rows[0].row.params).toMatchObject({ reason: 'cambio', prev: 'none' });
  });

  it('writes «sigue» once the keep-alive has passed, not before', () => {
    const seen = new Map<string, SeenState>([[claimKey(claim()), { state: 'none', writtenAt: T0 }]]);
    expect(decideWrites([claim()], seen, T0 + SHADOW_KEEPALIVE_MS - 1).rows).toHaveLength(0);
    const { rows, changes } = decideWrites([claim()], seen, T0 + SHADOW_KEEPALIVE_MS);
    expect(rows[0].row.params.reason).toBe('sigue');
    expect(changes).toBe(0);
  });

  it('does not touch the memory: a failed insert is tried again next cycle', () => {
    const seen = new Map<string, SeenState>();
    decideWrites([claim()], seen, T0);
    expect(seen.size).toBe(0);
    expect(decideWrites([claim()], seen, T0 + 600_000).rows).toHaveLength(1);
    markWritten(seen, claimKey(claim()), 'none', T0);
    expect(decideWrites([claim()], seen, T0 + 600_000).rows).toHaveLength(0);
  });

  it('keeps one answer per key and cycle, and treats spots apart', () => {
    const a = claim({ type: 'shadow-rain-now', subject: 'cesantes', state: 'dry' });
    const b = claim({ type: 'shadow-rain-now', subject: 'vao', state: 'raining' });
    const { rows } = decideWrites([a, { ...a, state: 'raining' }, b], new Map(), T0);
    expect(rows.map((r) => r.key)).toEqual(['shadow-rain-now|rias|cesantes', 'shadow-rain-now|rias|vao']);
    expect(rows[0].row.level).toBe('dry');
  });
});

describe('seenFromRows', () => {
  it('keeps the newest row of each key', () => {
    const seen = seenFromRows([
      { alert_type: 'shadow-frost', sector: 'embalse', level: 'none', subject: null, time: new Date(T0) },
      { alert_type: 'shadow-frost', sector: 'embalse', level: 'riesgo', subject: null, time: new Date(T0 + 1000) },
      { alert_type: 'shadow-rain-now', sector: 'rias', level: 'dry', subject: 'vao', time: '2026-11-11T09:00:00Z' },
    ]);
    expect(seen.get('shadow-frost|embalse|')).toEqual({ state: 'riesgo', writtenAt: T0 + 1000 });
    expect(seen.get('shadow-rain-now|rias|vao')?.state).toBe('dry');
  });

  it('after a restart the same state within the keep-alive writes nothing', () => {
    const seen = seenFromRows([{ alert_type: 'shadow-fog-physics', sector: 'rias', level: 'none', subject: null, time: new Date(T0) }]);
    expect(decideWrites([claim()], seen, T0 + 30 * 60_000).rows).toHaveLength(0);
  });
});

describe('describeCycle', () => {
  it('is one line with the counts and what had no data', () => {
    expect(describeCycle(7, 31, 2, 3, [])).toBe('[Sombra] 7 soluciones, 31 estados, 2 cambios, 3 filas');
    expect(describeCycle(6, 20, 0, 0, ['prevision rias'])).toContain('(sin dato: prevision rias)');
  });
});
