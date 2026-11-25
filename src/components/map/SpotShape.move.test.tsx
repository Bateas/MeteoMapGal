import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SpotShape } from './SpotShape';

/**
 * The ring goes to its new place in half a second. The arc itself always ends where the figure says:
 * what moves is how much of it is drawn, from where the ring was before.
 */
describe('SpotShape: the ring moves, it does not jump', () => {
  const shape = (gauge: number) => <SpotShape verdict="sailing" value="9" gauge={gauge} />;

  it('the first drawing stands still', () => {
    const { container } = render(shape(0.5));
    expect(container.querySelector('.gs-grow, .gs-shrink')).toBeNull();
  });

  it('more wind: the new arc draws itself from where the old one ended', () => {
    const { container, rerender } = render(shape(0.25));
    rerender(shape(0.5));
    const arc = container.querySelector('path.gs-grow') as SVGPathElement;
    expect(arc).not.toBeNull();
    expect(Number(arc.style.getPropertyValue('--gs-from'))).toBeCloseTo(50, 5);
    expect(container.querySelector('.gs-shrink')).toBeNull();
  });

  it('less wind: the arc is already the short one and the stretch that is gone draws back', () => {
    const { container, rerender } = render(shape(0.5));
    rerender(shape(0.25));
    expect(container.querySelector('.gs-grow')).toBeNull();
    const gone = container.querySelector('path.gs-shrink')!;
    expect(gone).not.toBeNull();
    // It comes after the true arc, which stays the first path of the drawing.
    expect(container.querySelector('path')).not.toBe(gone);
  });

  it('a render that changes nothing does not start the movement again', () => {
    const { container, rerender } = render(shape(0.25));
    rerender(shape(0.5));
    const first = container.querySelector('path.gs-grow');
    rerender(shape(0.5));
    expect(container.querySelector('path.gs-grow')).toBe(first);
  });
});
