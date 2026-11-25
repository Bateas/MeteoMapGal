import { describe, it, expect, afterEach } from 'vitest';
import { pointsBySpot } from './useSpotTrendSeed';
import { useSpotStore } from '../store/spotStore';

afterEach(() => useSpotStore.setState({ windHistory: new Map() }));

describe('pointsBySpot', () => {
  it('groups by spot and leaves out a row with no figure or a bad time', () => {
    const got = pointsBySpot([
      { time: '2026-11-05 00:13:13.203+01', spot_id: 'cesantes', wind_kt: 4 },
      { time: '2026-11-05 00:08:12.141+01', spot_id: 'cesantes', wind_kt: null },
      { time: 'no', spot_id: 'cesantes', wind_kt: 3 },
      { time: '2026-11-05 00:13:13.203+01', spot_id: 'bocana', wind_kt: 0 },
    ]);
    expect(got.get('cesantes')).toHaveLength(1);
    expect(got.get('bocana')![0].kt).toBe(0);
  });
});

describe('seedWindHistory', () => {
  const MIN = 60_000;
  it('puts the older figures before what this visit has, in order', () => {
    const now = Date.now();
    useSpotStore.setState({ windHistory: new Map([['a', [{ ts: now - 5 * MIN, kt: 9 }]]]) });
    useSpotStore.getState().seedWindHistory(new Map([['a', [{ ts: now - 20 * MIN, kt: 7 }, { ts: now - 40 * MIN, kt: 6 }]]]));
    expect(useSpotStore.getState().windHistory.get('a')!.map((p) => p.kt)).toEqual([6, 7, 9]);
  });

  it('this visit wins over a stored figure of the same moment', () => {
    const now = Date.now();
    useSpotStore.setState({ windHistory: new Map([['a', [{ ts: now - 5 * MIN, kt: 9 }]]]) });
    useSpotStore.getState().seedWindHistory(new Map([['a', [{ ts: now - 5 * MIN + 1000, kt: 30 }]]]));
    expect(useSpotStore.getState().windHistory.get('a')!.map((p) => p.kt)).toEqual([9]);
  });

  it('leaves out what is older than the window', () => {
    useSpotStore.getState().seedWindHistory(new Map([['a', [{ ts: Date.now() - 3 * 3_600_000, kt: 7 }]]]));
    expect(useSpotStore.getState().windHistory.get('a')).toBeUndefined();
  });
});
