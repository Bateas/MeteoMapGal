import { describe, it, expect } from 'vitest';
import { dedupeByKey } from './dedupeByKey';

describe('dedupeByKey — F-03: two rows with the same key would fail the whole INSERT', () => {
  it('keeps one row per key, the last one, in first-seen order', () => {
    const rows = [{ k: 'a', v: 1 }, { k: 'b', v: 2 }, { k: 'a', v: 3 }];
    expect(dedupeByKey(rows, (r) => r.k)).toEqual([{ k: 'a', v: 3 }, { k: 'b', v: 2 }]);
  });

  it('returns the same array when there is nothing to remove', () => {
    const rows = [{ k: 'a' }, { k: 'b' }];
    expect(dedupeByKey(rows, (r) => r.k)).toBe(rows);
  });
});
