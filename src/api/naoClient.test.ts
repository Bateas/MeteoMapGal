import { describe, it, expect } from 'vitest';
import { summariseIndex, isFreshIndex, MAX_INDEX_AGE_DAYS } from './naoClient';

const file = (n: number, last = '2026-09-30') => {
  const end = Date.parse(`${last}T00:00:00Z`);
  const lines: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end - i * 86_400_000);
    lines.push(`${d.getUTCFullYear()}  ${d.getUTCMonth() + 1}  ${d.getUTCDate()}  ${(i % 3 - 1).toFixed(3)}`);
  }
  return lines.join('\n') + '\n';
};

describe('summariseIndex', () => {
  it('takes the last line as today and the 30-day mean', () => {
    const s = summariseIndex(file(40), 'NAO')!;
    expect(s.date).toBe('2026-09-30');
    expect(s.value).toBe(-1);
    expect(s.name).toBe('NAO');
  });
  it('gives null with fewer than two lines', () => {
    expect(summariseIndex('2026 9 30 -0.775', 'AO')).toBeNull();
  });
});

describe('isFreshIndex', () => {
  it('drops an index older than the limit (NOAA file stopped on 30-sep)', () => {
    const oct21 = Date.parse('2026-10-21T12:00:00Z');
    expect(isFreshIndex({ date: '2026-09-30' }, oct21)).toBe(false);
    expect(isFreshIndex({ date: '2026-10-15' }, oct21)).toBe(true);
    expect(MAX_INDEX_AGE_DAYS).toBe(10);
  });
  it('treats an unreadable date as stale', () => {
    expect(isFreshIndex({ date: 'nope' })).toBe(false);
  });
});
