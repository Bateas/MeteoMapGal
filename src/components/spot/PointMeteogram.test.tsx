import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PointMeteogram } from './PointMeteogram';
import type { DaySummary, PointHour } from '../../services/pointForecast';

function day(overrides: Partial<PointHour> = {}, rainAt: Record<number, number> = {}): DaySummary {
  const hours: PointHour[] = Array.from({ length: 14 }, (_, i) => ({
    hour: 7 + i, rainMm: rainAt[7 + i] ?? 0, kt: 10, dirDeg: 0, dir: 'N', temp: 14, ...overrides,
  }));
  return { dayKey: '2026-11-09', label: 'lun 9', hours, bands: [] };
}

describe('PointMeteogram', () => {
  it('draws one rain bar per wet hour and one wind bar per hour', () => {
    const { container } = render(<PointMeteogram days={[day({}, { 8: 4.9, 12: 0.2 })]} />);
    expect(container.querySelectorAll('.gfp-r')).toHaveLength(2);
    expect(container.querySelectorAll('.gfp-w')).toHaveLength(14);
  });

  it('labels the peak of rain only when it is worth saying', () => {
    const heavy = render(<PointMeteogram days={[day({}, { 8: 4.9 })]} />);
    expect(heavy.container.textContent).toContain('4,9');
    const light = render(<PointMeteogram days={[day({}, { 8: 1.5 })]} />);
    expect(light.container.textContent).not.toContain('1,5');
  });

  it('points the arrow where the wind goes', () => {
    const { container } = render(<PointMeteogram days={[day({ dirDeg: 90 })]} />);
    // Wind from the east goes west: the north-drawn tip turns 270 degrees.
    expect(container.querySelector('.gfp-arrow')?.getAttribute('transform')).toContain('rotate(270)');
  });

  it('names every row and writes each day its warmest and coldest hour', () => {
    const d = day();
    d.hours[2].temp = 16.2;
    d.hours[9].temp = 11.4;
    const { container } = render(<PointMeteogram days={[d]} />);
    for (const name of ['Lluvia', 'Viento', 'Temp.']) expect(container.textContent).toContain(name);
    expect(container.textContent).toContain('16°');
    expect(container.textContent).toContain('11°');
  });

  it('writes no temperatures for a flat day', () => {
    const { container } = render(<PointMeteogram days={[day()]} />);
    expect(container.textContent).not.toContain('14°');
  });

  it('survives hours the model does not give', () => {
    const empty = day({ rainMm: null, kt: null, dirDeg: null, temp: null });
    expect(() => render(<PointMeteogram days={[empty]} />)).not.toThrow();
  });

  it('draws nothing without days', () => {
    const { container } = render(<PointMeteogram days={[]} />);
    expect(container.textContent).toBe('');
  });
});
