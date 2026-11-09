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

  describe('the mark of the current time', () => {
    const x = (el: Element | null | undefined) => Number(el?.getAttribute('x1'));

    it('sits on today where the axis has that time', () => {
      const { container } = render(<PointMeteogram days={[day()]} now={new Date('2026-11-09T12:45:00+01:00')} />);
      const ticks = container.querySelectorAll('.gfp-grid');
      const at12 = x(ticks[1]), at16 = x(ticks[2]);
      expect(x(container.querySelector('.gfp-nowline'))).toBeCloseTo(at12 + ((at16 - at12) * 0.75) / 4, 3);
      expect(container.textContent).toContain('ahora');
    });

    it('goes in the column of today, not the first one', () => {
      const tomorrow = { ...day(), dayKey: '2026-11-10', label: 'mar 10' };
      const { container } = render(<PointMeteogram days={[day(), tomorrow]} now={new Date('2026-11-10T08:00:00+01:00')} />);
      const ticks = container.querySelectorAll('.gfp-grid');
      expect(x(container.querySelector('.gfp-nowline'))).toBeCloseTo(x(ticks[4]), 3);
    });

    it('is not drawn on a chart without today, before or after its hours, or without a clock', () => {
      for (const now of [new Date('2026-11-12T12:00:00+01:00'), new Date('2026-11-09T03:00:00+01:00'), new Date('2026-11-09T22:00:00+01:00'), undefined]) {
        const { container } = render(<PointMeteogram days={[day()]} now={now} />);
        expect(container.querySelector('.gfp-nowline')).toBeNull();
      }
    });
  });

  it('draws nothing without days', () => {
    const { container } = render(<PointMeteogram days={[]} />);
    expect(container.textContent).toBe('');
  });
});
