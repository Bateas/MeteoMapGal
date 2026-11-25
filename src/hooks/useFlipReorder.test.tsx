/**
 * The rows that changed place slide from where they were. Nothing moves when the order is the same,
 * when a row is new, or with reduced motion. jsdom has no layout, so offsetTop comes from data-top.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useRef } from 'react';
import { render } from '@testing-library/react';
import { useFlipReorder } from './useFlipReorder';

function List({ order }: { order: string[] }) {
  const ref = useRef<HTMLUListElement>(null);
  useFlipReorder(ref, order.join());
  return (
    <ul ref={ref}>
      {order.map((id, i) => <li key={id} data-flip-key={id} data-top={i * 50} />)}
    </ul>
  );
}

const animate = vi.fn();
let reduced = false;

beforeEach(() => {
  animate.mockClear();
  reduced = false;
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get() { return Number((this as HTMLElement).dataset.top ?? 0); },
  });
  (HTMLElement.prototype as unknown as { animate: typeof animate }).animate = animate;
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced })));
});

afterEach(() => {
  delete (HTMLElement.prototype as unknown as { offsetTop?: number }).offsetTop;
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  vi.unstubAllGlobals();
});

describe('useFlipReorder', () => {
  it('a swap slides both rows from their old place', () => {
    const { rerender } = render(<List order={['a', 'b']} />);
    rerender(<List order={['b', 'a']} />);
    expect(animate).toHaveBeenCalledTimes(2);
    const translations = animate.mock.calls.map(([frames]) => frames[0].transform);
    expect(translations).toEqual(['translateY(50px)', 'translateY(-50px)']);
    expect(animate.mock.calls[0][1].duration).toBe(200);
  });

  it('the same order moves nothing, however many times it renders', () => {
    const { rerender } = render(<List order={['a', 'b']} />);
    rerender(<List order={['a', 'b']} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('the first render moves nothing', () => {
    render(<List order={['a', 'b']} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('a row that was not there does not slide in from nowhere', () => {
    const { rerender } = render(<List order={['a']} />);
    rerender(<List order={['b', 'a']} />);
    expect(animate).toHaveBeenCalledTimes(1); // only «a», which moved
  });

  it('with reduced motion nothing moves', () => {
    reduced = true;
    const { rerender } = render(<List order={['a', 'b']} />);
    rerender(<List order={['b', 'a']} />);
    expect(animate).not.toHaveBeenCalled();
  });
});
