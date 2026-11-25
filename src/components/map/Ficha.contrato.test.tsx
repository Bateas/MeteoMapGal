/**
 * Contract tests for the card shell (17-nov, zone 2 of the plan): it closes with a click on the map only when it was
 * asked to, never when that same click opened another card, and the arrow of a fold points the way it opens. They
 * cover breaks the full sweep of 12-nov left alive in Ficha.tsx. Each was checked to fail with its break put in.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const fake = vi.hoisted(() => ({ map: null as unknown }));
vi.mock('react-map-gl/maplibre', () => ({ useMap: () => ({ current: fake.map }) }));

import { Ficha, Chevron } from './Ficha';
import { useUIStore } from '../../store/uiStore';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function fakeMap() {
  const handlers: Record<string, ((e?: unknown) => void)[]> = {};
  return {
    panBy: vi.fn(),
    project: () => ({ x: 100, y: 100 }),
    isMoving: () => false,
    getContainer: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 }) }),
    once: (type: string, fn: (e?: unknown) => void) => { (handlers[type] ??= []).push(fn); },
    on: (type: string, fn: (e?: unknown) => void) => { (handlers[type] ??= []).push(fn); },
    off: (type: string, fn: (e?: unknown) => void) => { handlers[type] = (handlers[type] ?? []).filter((h) => h !== fn); },
    fire: (type: string, e?: unknown) => { [...(handlers[type] ?? [])].forEach((h) => h(e)); },
    count: (type: string) => (handlers[type] ?? []).length,
  };
}

afterEach(() => {
  cleanup();
  fake.map = null;
  useUIStore.setState({ isMobile: false });
});

describe('a click on the map', () => {
  it('closes a card that asked for it', async () => {
    const map = fakeMap();
    fake.map = map;
    const onClose = vi.fn();
    render(<Ficha longitude={-8.7} latitude={42.3} onClose={onClose} mapClickKey="a">hola</Ficha>);
    map.fire('click');
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves alone a card that did not ask for it, and listens to nothing', async () => {
    const map = fakeMap();
    fake.map = map;
    const onClose = vi.fn();
    render(<Ficha longitude={-8.7} latitude={42.3} onClose={onClose}>hola</Ficha>);
    expect(map.count('click')).toBe(0);
    map.fire('click');
    await tick();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close it when the same click opened another one', async () => {
    const map = fakeMap();
    fake.map = map;
    const onClose = vi.fn();
    const { rerender } = render(<Ficha longitude={-8.7} latitude={42.3} onClose={onClose} mapClickKey="a">hola</Ficha>);
    map.fire('click');
    rerender(<Ficha longitude={-8.7} latitude={42.3} onClose={onClose} mapClickKey="b">hola</Ficha>);
    await tick();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening when the card goes', () => {
    const map = fakeMap();
    fake.map = map;
    const view = render(<Ficha longitude={-8.7} latitude={42.3} onClose={() => {}} mapClickKey="a">hola</Ficha>);
    expect(map.count('click')).toBe(1);
    view.unmount();
    expect(map.count('click')).toBe(0);
  });
});

describe('the arrow of a fold', () => {
  it.each([
    ['closed', {}, 'rotate(0deg)'],
    ['open', { open: true }, 'rotate(180deg)'],
    ['sideways', { dir: 'right' as const }, 'rotate(-90deg)'],
    ['sideways and open', { dir: 'right' as const, open: true }, 'rotate(-90deg)'],
  ] as const)('%s', (_, props, transform) => {
    const { container } = render(<Chevron {...props} />);
    expect((container.querySelector('svg') as SVGElement).style.transform).toBe(transform);
  });
});
