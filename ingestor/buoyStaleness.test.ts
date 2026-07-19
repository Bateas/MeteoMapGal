/**
 * Tests for ingestor/buoyStaleness — per-station silence detection.
 *
 * The failure this guards against: a buoy stops reporting while its
 * neighbours keep going, so every global "did we get anything?" check
 * stays green. Locks the two properties that make the alarm usable —
 * it fires per station, and it doesn't spam once it has fired.
 */

import { describe, it, expect } from 'vitest';
import {
  findStaleBuoys,
  formatSilence,
  type FindStaleBuoysInput,
} from './buoyStaleness';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 6, 20, 12, 0, 0);

function input(overrides: Partial<FindStaleBuoysInput> = {}): FindStaleBuoysInput {
  return {
    now: NOW,
    lastSeen: new Map(),
    lastWarnedAt: new Map(),
    staleAfterMs: 12 * HOUR,
    reWarnAfterMs: 12 * HOUR,
    ...overrides,
  };
}

describe('findStaleBuoys', () => {
  it('ignores stations seen within the threshold', () => {
    const stale = findStaleBuoys(
      input({ lastSeen: new Map([[3223, NOW - 6 * HOUR]]) }),
    );
    expect(stale).toEqual([]);
  });

  it('flags a station silent past the threshold', () => {
    const stale = findStaleBuoys(
      input({ lastSeen: new Map([[3223, NOW - 13 * HOUR]]) }),
    );
    expect(stale).toEqual([{ stationId: 3223, silentMs: 13 * HOUR }]);
  });

  it('flags one dead station while its neighbours keep reporting', () => {
    // The 40-day blackout signature: a global counter sees plenty of data
    // every cycle, so only per-station tracking can catch this.
    const stale = findStaleBuoys(
      input({
        lastSeen: new Map([
          [2248, NOW - 40 * 24 * HOUR], // dead
          [3223, NOW - 10 * 60_000], // healthy
          [1250, NOW - 20 * 60_000], // healthy
        ]),
      }),
    );
    expect(stale.map((s) => s.stationId)).toEqual([2248]);
  });

  it('never flags a station that has no reading on record', () => {
    // Unknown != stale. Decommissioned buoys must not alarm forever.
    expect(findStaleBuoys(input({ lastSeen: new Map() }))).toEqual([]);
  });

  it('suppresses a re-warn inside the cooldown', () => {
    const stale = findStaleBuoys(
      input({
        lastSeen: new Map([[2248, NOW - 30 * 24 * HOUR]]),
        lastWarnedAt: new Map([[2248, NOW - 2 * HOUR]]),
      }),
    );
    expect(stale).toEqual([]);
  });

  it('re-warns once the cooldown has elapsed', () => {
    const stale = findStaleBuoys(
      input({
        lastSeen: new Map([[2248, NOW - 30 * 24 * HOUR]]),
        lastWarnedAt: new Map([[2248, NOW - 13 * HOUR]]),
      }),
    );
    expect(stale.map((s) => s.stationId)).toEqual([2248]);
  });

  it('sorts longest-silent first', () => {
    const stale = findStaleBuoys(
      input({
        lastSeen: new Map([
          [3223, NOW - 20 * HOUR],
          [2248, NOW - 5 * 24 * HOUR],
          [1250, NOW - 13 * HOUR],
        ]),
      }),
    );
    expect(stale.map((s) => s.stationId)).toEqual([2248, 3223, 1250]);
  });

  it('treats the threshold as inclusive', () => {
    const stale = findStaleBuoys(
      input({ lastSeen: new Map([[3223, NOW - 12 * HOUR]]) }),
    );
    expect(stale.map((s) => s.stationId)).toEqual([3223]);
  });
});

describe('formatSilence', () => {
  it('reports hours below two days', () => {
    expect(formatSilence(13 * HOUR)).toBe('13h');
    expect(formatSilence(47 * HOUR)).toBe('47h');
  });

  it('switches to days at 48h', () => {
    expect(formatSilence(48 * HOUR)).toBe('2d');
    expect(formatSilence(40 * 24 * HOUR)).toBe('40d');
  });
});
