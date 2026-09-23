/**
 * A tile layer that keeps failing must stop asking. One session with the
 * SWAN layer open did 1,071 failed requests in five minutes because nothing
 * ever told it to stop. These tests pin when it trips, how long it waits, and
 * that it recovers on its own.
 */
import { describe, it, expect } from 'vitest';
import { createTileBreaker } from './tileErrorBreaker';

const MIN = 60_000;

function breaker(opts = {}) {
  let t = 0;
  const b = createTileBreaker({ clock: () => t, ...opts });
  return { b, tick: (ms: number) => { t += ms; }, now: () => t };
}

describe('createTileBreaker', () => {
  it('trips after six failures close together', () => {
    const { b } = breaker();
    for (let i = 0; i < 5; i++) expect(b.recordError()).toBe(false);
    expect(b.recordError()).toBe(true);
    expect(b.canTry()).toBe(false);
  });

  it('does not trip on the odd failure spread over minutes', () => {
    const { b, tick } = breaker();
    for (let i = 0; i < 20; i++) {
      expect(b.recordError()).toBe(false);
      tick(10_000); // one every ten seconds: never six inside thirty
    }
    expect(b.canTry()).toBe(true);
  });

  it('waits five minutes after the first trip, then lets it try again', () => {
    const { b, tick } = breaker();
    for (let i = 0; i < 6; i++) b.recordError();
    tick(5 * MIN - 1);
    expect(b.canTry()).toBe(false);
    tick(2);
    expect(b.canTry()).toBe(true);
  });

  it('doubles the wait each time it trips in a row, up to half an hour', () => {
    const { b, tick, now } = breaker();
    const waits: number[] = [];
    for (let trip = 0; trip < 5; trip++) {
      for (let i = 0; i < 6; i++) b.recordError();
      waits.push(b.backoffUntil() - now());
      tick(b.backoffUntil() - now());
    }
    expect(waits).toEqual([5, 10, 20, 30, 30].map((m) => m * MIN));
  });

  it('a success closes it and forgets the doubling', () => {
    const { b, tick, now } = breaker();
    for (let i = 0; i < 6; i++) b.recordError();
    tick(5 * MIN);
    for (let i = 0; i < 6; i++) b.recordError(); // second trip: ten minutes
    tick(10 * MIN);
    b.recordSuccess();
    for (let i = 0; i < 6; i++) b.recordError();
    expect(b.backoffUntil() - now()).toBe(5 * MIN); // back to the base wait
  });

  it('failures while it is already tripped do not stretch the wait', () => {
    const { b, tick } = breaker();
    for (let i = 0; i < 6; i++) b.recordError();
    const until = b.backoffUntil();
    tick(MIN);
    for (let i = 0; i < 50; i++) expect(b.recordError()).toBe(false);
    expect(b.backoffUntil()).toBe(until);
  });

  it('still trips when successes and failures come mixed in one burst', () => {
    // Half a viewport loads, the other half is refused: exactly the case
    // that must not slip through.
    const { b } = breaker();
    let tripped = false;
    for (let i = 0; i < 6; i++) {
      b.recordSuccess();
      tripped = b.recordError() || tripped;
    }
    expect(tripped).toBe(true);
  });
});
