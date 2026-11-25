import { describe, it, expect } from 'vitest';
import { ageMinutes, ageWords, dataAge, DATA_GONE_MIN, DATA_OLD_MIN } from './dataAge';

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);

describe('ageMinutes', () => {
  it('reads a Date, an epoch and an ISO string', () => {
    const at = NOW - 40 * 60_000;
    expect(ageMinutes(new Date(at), NOW)).toBe(40);
    expect(ageMinutes(at, NOW)).toBe(40);
    expect(ageMinutes(new Date(at).toISOString(), NOW)).toBe(40);
  });

  it('nothing to read is no age, and a clock ahead of ours is not negative', () => {
    expect(ageMinutes(null, NOW)).toBeNull();
    expect(ageMinutes('sin fecha', NOW)).toBeNull();
    expect(ageMinutes(NOW + 60_000, NOW)).toBe(0);
  });
});

describe('dataAge', () => {
  it('fresh up to the limit, old after it, gone past two hours', () => {
    expect(dataAge(DATA_OLD_MIN)).toBe('fresh');
    expect(dataAge(DATA_OLD_MIN + 1)).toBe('old');
    expect(dataAge(DATA_GONE_MIN)).toBe('old');
    expect(dataAge(DATA_GONE_MIN + 1)).toBe('gone');
  });

  it('no reading at all counts as gone', () => {
    expect(dataAge(null)).toBe('gone');
  });

  it('a source can bring its own limits', () => {
    expect(dataAge(150, { oldMin: 120, goneMin: 240 })).toBe('old');
    expect(dataAge(100, { oldMin: 120, goneMin: 240 })).toBe('fresh');
  });
});

describe('ageWords', () => {
  it('says it in minutes, hours or days', () => {
    expect(ageWords(40)).toBe('hace 40 min');
    expect(ageWords(180)).toBe('hace 3 h');
    expect(ageWords(3 * 24 * 60)).toBe('hace 3 d');
  });
});
