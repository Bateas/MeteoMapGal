import { describe, it, expect } from 'vitest';
import { spotTwinOffset } from './spotTwins';
import { ALL_SPOTS } from '../../config/spots';

/** The widest a spot shape is drawn, and the km a degree of latitude is. */
const SHAPE_PX = 72;
const KM_PER_DEG = 111;

const kmBetween = (a: { center: [number, number] }, b: { center: [number, number] }) =>
  Math.hypot((a.center[0] - b.center[0]) * 0.74, a.center[1] - b.center[1]) * KM_PER_DEG;

describe('two spots on the same beach', () => {
  const pairs = ALL_SPOTS.flatMap((wind) => ALL_SPOTS
    .filter((surf) => wind.category !== 'surf' && surf.category === 'surf' && kmBetween(wind, surf) < 1)
    .map((surf) => [wind, surf] as const));

  it('there is at least one, A Lanzada: if not, this says nothing', () => {
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.some(([w]) => w.id === 'lanzada')).toBe(true);
  });

  it.each(pairs.map(([w, s]) => [w.id, s.id]))('%s and %s are drawn side by side, not one on top of the other', (windId, surfId) => {
    expect(Math.abs(spotTwinOffset(windId) - spotTwinOffset(surfId))).toBeGreaterThanOrEqual(SHAPE_PX);
  });

  it('nobody else moves: a spot off its point has to have a reason', () => {
    const twins = new Set(pairs.flat().map((s) => s.id));
    for (const s of ALL_SPOTS) if (!twins.has(s.id)) expect(spotTwinOffset(s.id)).toBe(0);
  });
});
