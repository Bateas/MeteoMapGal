import { describe, it, expect } from 'vitest';
import { localWaveHeight } from './spotWaveLocal';

describe('localWaveHeight', () => {
  it('SWAN at the spot wins over the open-ocean buoy (Cíes 21-oct: 2.1 m vs 3.4 m)', () => {
    expect(localWaveHeight({ coastalFactor: 0.6 }, 3.4, 2.08)).toEqual({ heightM: 2.08, source: 'swan' });
  });
  it('without SWAN, the buoy times the spot factor, labelled as an estimate', () => {
    const r = localWaveHeight({ coastalFactor: 0.6 }, 3.4, null)!;
    expect(r.source).toBe('estimate');
    expect(r.heightM).toBeCloseTo(2.04, 2);
  });
  it('a spot with no factor keeps the buoy', () => {
    expect(localWaveHeight({}, 3.4)).toEqual({ heightM: 3.4, source: 'buoy' });
  });
  it('ignores an absurd SWAN value and gives null with nothing', () => {
    expect(localWaveHeight({ coastalFactor: 0.6 }, 3.4, 99)!.source).toBe('estimate');
    expect(localWaveHeight({}, null, null)).toBeNull();
  });
});
