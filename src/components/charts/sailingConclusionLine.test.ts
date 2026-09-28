import { describe, it, expect } from 'vitest';
import { sailingConclusionLine } from './sailingConclusionLine';

const base = { bestKt: 0, bestTimeLabel: null, rainHours: 0, directionConsistency: 80 };

describe('sailingConclusionLine', () => {
  it('never calls a windy rainy day calm (the eve of the 29-sep front: 25 kt S, 6 h of rain)', () => {
    const l = sailingConclusionLine({ ...base, bestKt: 25, bestTimeLabel: 'mar 14:00', rainHours: 6 });
    expect(l.tone).toBe('strong');
    expect(l.text).toBe('Viento fuerte: hasta 25 kt sobre las mar 14:00, con lluvia (6 h).');
    expect(l.text).not.toMatch(/calma/i);
  });

  it('good wind with rain says both and points to the dry hours', () => {
    const l = sailingConclusionLine({ ...base, bestKt: 12, rainHours: 3 });
    expect(l.tone).toBe('mixed');
    expect(l.icon).toBe('cloud-rain');
    expect(l.text).toMatch(/12 kt.*lluvia \(3 h\)/);
  });

  it('strong from 18 kt, the same scale as the spot verdict', () => {
    expect(sailingConclusionLine({ ...base, bestKt: 17.4 }).tone).toBe('good');
    expect(sailingConclusionLine({ ...base, bestKt: 18 }).tone).toBe('strong');
  });

  it('keeps the old lines for the cases it already covered', () => {
    expect(sailingConclusionLine({ ...base, bestKt: 12 }).text).toMatch(/^Buen dia para navegar/);
    expect(sailingConclusionLine({ ...base, bestKt: 12, directionConsistency: 30 }).text).toMatch(/direccion inestable/);
    expect(sailingConclusionLine({ ...base, bestKt: 5 }).text).toMatch(/^Viento flojo/);
    expect(sailingConclusionLine({ ...base, bestKt: 2 }).text).toMatch(/dia de calma/);
  });

  it('a single rainy hour does not turn a good day into a rainy one', () => {
    expect(sailingConclusionLine({ ...base, bestKt: 12, rainHours: 1 }).tone).toBe('good');
  });
});
