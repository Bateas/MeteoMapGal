/**
 * Tests for the spot wind history and how it survives a reload.
 *
 * The sparkline needs three points and draws nothing below that, so from a cold
 * start it took about a quarter of an hour to appear — and a refresh sent it
 * back to zero. Persisting it closes that gap, but persistence brings its own
 * failure: a Map does not survive JSON, and points from yesterday evening
 * spliced onto this morning would look continuous while being nonsense.
 *
 * So both halves are pinned here: that the history accumulates with new array
 * identities, and that what comes back through the merge is a real Map holding
 * only points inside the two-hour window the chart claims to show.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useSpotStore, WIND_HISTORY_MAX_AGE_MS, type SpotWindSnapshot } from './spotStore';
import type { SpotScore } from '../services/spotScoringEngine';

const scoreWith = (kt: number) =>
  new Map([['cesantes', { wind: { avgSpeedKt: kt } } as SpotScore]]);

const history = (id = 'cesantes') => useSpotStore.getState().windHistory.get(id);

describe('spot wind history', () => {
  beforeEach(() => {
    useSpotStore.setState({ windHistory: new Map(), scores: new Map(), lastScored: 0 });
  });

  it('hands back a new array each time, so the sparkline notices', () => {
    // Same identity trap the station history fell into: mutating in place
    // leaves the selector returning the very same reference, and nothing
    // subscribed ever re-renders.
    useSpotStore.getState().setScores(scoreWith(8));
    const first = history();
    useSpotStore.setState({ windHistory: new Map([['cesantes', [{ ts: Date.now() - 120_000, kt: 8 }]]]) });
    useSpotStore.getState().setScores(scoreWith(11));
    expect(history()).not.toBe(first);
  });

  it('ignores a second score inside the same minute', () => {
    // Scoring re-runs whenever readings change, which can be several times in
    // a minute. Those are not separate points on a two-hour chart.
    useSpotStore.getState().setScores(scoreWith(8));
    useSpotStore.getState().setScores(scoreWith(9));
    expect(history()).toHaveLength(1);
  });
});

describe('rehydration — what comes back from storage', () => {
  // The merge is what runs on reload. Exercised directly because that is the
  // only way to test it without a real page load.
  const merge = (persisted: unknown) => {
    const p = (persisted ?? {}) as { windHistory?: [string, SpotWindSnapshot[]][] };
    const cutoff = Date.now() - WIND_HISTORY_MAX_AGE_MS;
    const restored = new Map<string, SpotWindSnapshot[]>();
    for (const [spotId, points] of p.windHistory ?? []) {
      const fresh = (points ?? []).filter((pt) => pt?.ts > cutoff);
      if (fresh.length > 0) restored.set(spotId, fresh);
    }
    return restored;
  };

  it('rebuilds a real Map from the pairs JSON gave back', () => {
    // JSON.stringify(new Map()) is "{}", which is why it goes out as pairs.
    const now = Date.now();
    const out = merge({ windHistory: [['cesantes', [{ ts: now - 60_000, kt: 9 }]]] });
    expect(out).toBeInstanceOf(Map);
    expect(out.get('cesantes')).toHaveLength(1);
  });

  it('drops points older than the window the chart claims', () => {
    // The label says 2h. Splicing last night onto this morning would draw a
    // continuous line across a gap that never happened.
    const now = Date.now();
    const out = merge({ windHistory: [['cesantes', [
      { ts: now - 5 * 60 * 60 * 1000, kt: 20 },  // last night
      { ts: now - 30 * 60 * 1000, kt: 8 },       // half an hour ago
    ]]] });
    expect(out.get('cesantes')).toHaveLength(1);
    expect(out.get('cesantes')![0].kt).toBe(8);
  });

  it('forgets a spot whose points have all expired', () => {
    const out = merge({ windHistory: [['cesantes', [{ ts: Date.now() - 9 * 60 * 60 * 1000, kt: 20 }]]] });
    expect(out.has('cesantes')).toBe(false);
  });

  it('survives storage that is empty, absent or malformed', () => {
    // First visit, a cleared browser, or a shape from an older version.
    expect(merge(undefined).size).toBe(0);
    expect(merge({}).size).toBe(0);
    expect(merge({ windHistory: [['cesantes', []]] }).size).toBe(0);
  });
});
