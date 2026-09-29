import { describe, it, expect } from 'vitest';
import { stationsToPaint, ICA_ACTIVATION_THRESHOLD } from './icaPaint';

describe('stationsToPaint — only the stations that turned the ICA overlay on (29-sep)', () => {
  it('Est-Ou at 3.0 is painted; Coia at 2.8 («Moderada», gale sea salt) is not', () => {
    const painted = stationsToPaint([
      { station: 'Coia', ica: 2.8 },
      { station: 'Est-Ou', ica: 3.0 },
    ]);
    expect(painted.map((r) => r.station)).toEqual(['Est-Ou']);
  });

  it('paints from the same threshold that activates the overlay', () => {
    expect(ICA_ACTIVATION_THRESHOLD).toBe(3);
    expect(stationsToPaint([{ ica: 2.99 }, { ica: 3 }, { ica: 4.2 }]).map((r) => r.ica)).toEqual([3, 4.2]);
  });

  it('ignores readings without a number', () => {
    expect(stationsToPaint([{ ica: Number.NaN }, { ica: 3.5 }])).toHaveLength(1);
  });
});
