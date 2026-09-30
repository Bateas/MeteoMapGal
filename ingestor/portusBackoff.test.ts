import { describe, it, expect } from 'vitest';
import {
  shouldAskPortus, isBackingOff, nextPortusBackoff,
  PORTUS_BACKOFF_AFTER_FAILS, PORTUS_BACKOFF_PROBE_MS, type PortusBackoff,
} from './portusBackoff';

const MIN = 60_000;
const CYCLE = 5 * MIN;

describe('portusBackoff', () => {
  it('keeps asking every cycle through the first failures', () => {
    let s: PortusBackoff | undefined;
    for (let i = 0; i < PORTUS_BACKOFF_AFTER_FAILS - 1; i++) {
      s = nextPortusBackoff(s, true, i * CYCLE);
      expect(shouldAskPortus(s, (i + 1) * CYCLE)).toBe(true);
      expect(isBackingOff(s)).toBe(false);
    }
  });

  it('after three failed cycles it asks once an hour, and the probe skips the retry', () => {
    let s: PortusBackoff | undefined;
    for (let i = 0; i < PORTUS_BACKOFF_AFTER_FAILS; i++) s = nextPortusBackoff(s, true, i * CYCLE);
    const last = (PORTUS_BACKOFF_AFTER_FAILS - 1) * CYCLE;
    expect(isBackingOff(s)).toBe(true);
    expect(shouldAskPortus(s, last + CYCLE)).toBe(false);
    expect(shouldAskPortus(s, last + PORTUS_BACKOFF_PROBE_MS - MIN)).toBe(false);
    expect(shouldAskPortus(s, last + PORTUS_BACKOFF_PROBE_MS)).toBe(true);
    expect(s!.since).toBe(0);
  });

  it('any answer clears it at once', () => {
    let s: PortusBackoff | undefined;
    for (let i = 0; i < 10; i++) s = nextPortusBackoff(s, true, i * CYCLE);
    s = nextPortusBackoff(s, false, 11 * CYCLE);
    expect(s).toBeUndefined();
    expect(shouldAskPortus(s, 11 * CYCLE + 1)).toBe(true);
  });

  it('an empty or old payload is not a failure: that station keeps being asked', () => {
    // The caller passes failed=false for a 200 without new data, so nothing accumulates.
    let s: PortusBackoff | undefined;
    for (let i = 0; i < 20; i++) s = nextPortusBackoff(s, false, i * CYCLE);
    expect(s).toBeUndefined();
  });

  it('Rande answering 500 all day: from ~576 requests to about one an hour', () => {
    // Before: every 5-min cycle one request plus the retry after a 5xx = 288 x 2.
    let s: PortusBackoff | undefined;
    let requests = 0;
    for (let t = 0; t < 24 * 60 * MIN; t += CYCLE) {
      if (!shouldAskPortus(s, t)) continue;
      requests += isBackingOff(s) ? 1 : 2; // no retry once it is known to be failing
      s = nextPortusBackoff(s, true, t);
    }
    expect(requests).toBeLessThanOrEqual(30);
    expect(requests).toBeGreaterThanOrEqual(24); // still probed every hour, never forgotten
  });
});
