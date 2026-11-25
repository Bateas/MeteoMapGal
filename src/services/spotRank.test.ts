/**
 * The order of the Spots tab and the spot the phone pill names when none is chosen. Both must sort
 * by what each spot shows: a closed spot goes last, a spot still calculating ranks on nothing, and a
 * beach ranks on its wave verdict, not on the wind.
 */
import { describe, it, expect } from 'vitest';
import { bestSpotOf, favoriteFirst, sortSpotsByVerdict, spotRank } from './spotRank';
import type { SpotScore, SpotVerdict } from './spotScoringEngine';
import type { SurfWaveEntry } from './surfVerdictEngine';

const sail = (id: string) => ({ id, category: 'sailing' as const });
const surf = (id: string) => ({ id, category: 'surf' as const });

function score(verdict: SpotVerdict, extra: Partial<SpotScore> = {}): SpotScore {
  return { verdict, provisional: false, hardGateTriggered: null, ...extra } as unknown as SpotScore;
}

function wave(level: number): SurfWaveEntry {
  return { waveHeight: 1, windPending: false, verdict: { level } } as unknown as SurfWaveEntry;
}

describe('sortSpotsByVerdict', () => {
  it('puts the best verdict first', () => {
    const scores = new Map([['a', score('calm')], ['b', score('good')], ['c', score('light')]]);
    expect(sortSpotsByVerdict([sail('a'), sail('b'), sail('c')], scores, new Map()).map((s) => s.id))
      .toEqual(['b', 'c', 'a']);
  });

  it('a spot closed by its own limit goes last, below a spot with no data', () => {
    const scores = new Map([['closed', score('strong', { hardGateTriggered: 'Mar 3 m' })], ['fine', score('light')]]);
    expect(sortSpotsByVerdict([sail('closed'), sail('fine'), sail('nodata')], scores, new Map()).map((s) => s.id))
      .toEqual(['fine', 'nodata', 'closed']);
  });

  it('a spot still calculating ranks on nothing, not on its hidden figure', () => {
    const scores = new Map([['calc', score('good', { provisional: true })], ['calm', score('calm')]]);
    expect(sortSpotsByVerdict([sail('calc'), sail('calm')], scores, new Map()).map((s) => s.id))
      .toEqual(['calm', 'calc']);
  });

  it('ties keep the order of the config', () => {
    const scores = new Map([['a', score('light')], ['b', score('light')]]);
    expect(sortSpotsByVerdict([sail('a'), sail('b')], scores, new Map()).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('does not touch the array it was given', () => {
    const spots = [sail('a'), sail('b')];
    sortSpotsByVerdict(spots, new Map([['b', score('good')]]), new Map());
    expect(spots.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('spotRank on a beach', () => {
  const beach = surf('playa');

  it('ranks on the wave verdict, not on the wind', () => {
    // Calm wind and a classic day: the beach is not a calm spot.
    const classic = spotRank({ spot: beach, score: score('calm'), surfEntry: wave(3) });
    const calmSpot = spotRank({ spot: sail('x'), score: score('calm') });
    expect(classic).toBeGreaterThan(calmSpot);
  });

  it('CLÁSICO above SURF OK above GRANDE, and FLAT below them', () => {
    const r = (level: number) => spotRank({ spot: beach, score: score('calm'), surfEntry: wave(level) });
    expect(r(3)).toBeGreaterThan(r(2));
    expect(r(2)).toBeGreaterThan(r(4));
    expect(r(4)).toBeGreaterThan(r(0));
  });

  it('with the forecast still loading it ranks on nothing', () => {
    expect(spotRank({ spot: beach, score: score('good') })).toBe(spotRank({ spot: sail('x') }));
  });

  it('over the hard gate it is closed like any spot', () => {
    expect(spotRank({ spot: beach, score: score('strong', { hardGateTriggered: 'Viento 30kt' }), surfEntry: wave(3) }))
      .toBeLessThan(spotRank({ spot: sail('x') }));
  });
});

describe('bestSpotOf', () => {
  it('names the best spot', () => {
    const scores = new Map([['a', score('light')], ['b', score('sailing')]]);
    expect(bestSpotOf([sail('a'), sail('b')], scores, new Map())?.id).toBe('b');
  });

  it('nothing when no spot has a verdict yet', () => {
    expect(bestSpotOf([sail('a'), sail('b')], new Map(), new Map())).toBeNull();
  });

  it('nothing when all are in calm: naming one would be the first of the list in disguise', () => {
    const scores = new Map([['a', score('calm')], ['b', score('calm')]]);
    expect(bestSpotOf([sail('a'), sail('b')], scores, new Map())).toBeNull();
  });

  it('nothing when every spot is closed', () => {
    const scores = new Map([['a', score('strong', { hardGateTriggered: 'Mar 3 m' })]]);
    expect(bestSpotOf([sail('a')], scores, new Map())).toBeNull();
  });

  it('nothing in an empty sector', () => {
    expect(bestSpotOf([], new Map(), new Map())).toBeNull();
  });
});

describe('favoriteFirst', () => {
  const list = [sail('a'), sail('b'), sail('c')];
  it('puts the favourite on top and leaves the others as they go', () => {
    expect(favoriteFirst(list, 'c').map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });
  it('with no favourite, or one of another sector, the list stays as it is', () => {
    expect(favoriteFirst(list, null).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(favoriteFirst(list, 'x').map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});
