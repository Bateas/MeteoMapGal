/**
 * The shell of every card on the map. One at a time, because they all open in the same place; and the
 * marker it talks about must be in view and not under it once it opens.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const fake = vi.hoisted(() => ({ map: null as unknown }));
vi.mock('react-map-gl/maplibre', () => ({ useMap: () => ({ current: fake.map }) }));

import { Ficha, panToClearCard } from './Ficha';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { SECTORS } from '../../config/sectors';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function fakeMap(marker: { x: number; y: number }, moving = false) {
  const handlers: Record<string, ((e?: unknown) => void)[]> = {};
  const off = (type: string, fn: (e?: unknown) => void) => {
    handlers[type] = (handlers[type] ?? []).filter((h) => h !== fn);
  };
  return {
    moving,
    panBy: vi.fn(),
    project: () => marker,
    isMoving() { return this.moving; },
    getContainer: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 }) }),
    once: (type: string, fn: (e?: unknown) => void) => { (handlers[type] ??= []).push(fn); },
    on: (type: string, fn: (e?: unknown) => void) => { (handlers[type] ??= []).push(fn); },
    off,
    fire: (type: string, e?: unknown) => { [...(handlers[type] ?? [])].forEach((h) => h(e)); },
  };
}

function cardAt(box: { top: number; right: number }) {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ left: 0, bottom: 700, x: 0, y: 0, width: 0, height: 0, toJSON: () => ({}), ...box }) as DOMRect,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  fake.map = null;
  delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
  useUIStore.setState({ isMobile: false });
  useSectorStore.setState({ activeSector: SECTORS[0] });
});

describe('Ficha', () => {
  it('is docked on a desktop, not a map popup', () => {
    render(<Ficha longitude={-8.7} latitude={42.3} onClose={() => {}}>hola</Ficha>);
    expect(screen.getByText('hola').closest('.gf-dock')).not.toBeNull();
  });

  it('opening one closes the other', () => {
    const closeFirst = vi.fn();
    render(<Ficha longitude={-8.7} latitude={42.3} onClose={closeFirst}>una</Ficha>);
    expect(closeFirst).not.toHaveBeenCalled();
    render(<Ficha longitude={-8.6} latitude={42.2} onClose={() => {}}>otra</Ficha>);
    expect(closeFirst).toHaveBeenCalledTimes(1);
  });

  it('closes with its button and with Escape, but Escape belongs to a text field or a dialog on top', () => {
    const onClose = vi.fn();
    render(<Ficha longitude={-8.7} latitude={42.3} onClose={onClose}><input aria-label="campo" /></Ficha>);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByLabelText('campo'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);

    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('aria-modal', 'true');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    dialog.remove();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('is a dialog named after what it shows on a phone', () => {
    useUIStore.setState({ isMobile: true });
    render(<Ficha longitude={-8.7} latitude={42.3} onClose={() => {}} titleId="t"><h2 id="t">Cesantes</h2></Ficha>);
    expect(screen.getByRole('dialog', { name: 'Cesantes' })).toBeInTheDocument();
  });

  it('closes when the sector changes, whoever keeps its selection', () => {
    const onClose = vi.fn();
    render(<Ficha longitude={-8.7} latitude={42.3} onClose={onClose}>incendio</Ficha>);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.body);
    useSectorStore.setState({ activeSector: SECTORS[1] });
    return tick().then(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('desktop: the focus goes to the card and comes back on close', () => {
    render(<button type="button">marcador</button>);
    screen.getByRole('button', { name: 'marcador' }).focus();
    const { unmount } = render(<Ficha longitude={-8.7} latitude={42.3} onClose={() => {}} titleId="t"><h2 id="t">Vao</h2></Ficha>);
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Vao' }));
    unmount();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'marcador' }));
  });

  // From disk: Vitest empties every .css import, raw included. Through a variable: no Node types in the
  // app tsconfig, and the test always runs under Node.
  it('never covers a danger notice: the notices sit above the card', async () => {
    const fsModule = 'node:fs';
    const { readFileSync } = await import(/* @vite-ignore */ fsModule) as { readFileSync: (path: string, encoding: string) => string };
    const chromeCss = readFileSync('src/styles/chrome.css', 'utf8');
    const fichaCss = readFileSync('src/styles/ficha.css', 'utf8');
    const zIndex = (css: string, rule: string) => Number(css.match(new RegExp(`\\.${rule} \\{[^}]*z-index: (\\d+)`))?.[1]);
    expect(zIndex(chromeCss, 'gc-mapstack')).toBeGreaterThan(zIndex(fichaCss, 'gf-dock'));
  });
});

describe('Ficha and the map', () => {
  const open = () => render(<Ficha longitude={-8.7} latitude={42.3} onClose={() => {}}>hola</Ficha>);

  it('takes the marker out from under the card', async () => {
    const map = fakeMap({ x: 200, y: 400 });
    fake.map = map;
    cardAt({ top: 12, right: 372 });
    open();
    await tick();
    expect(map.panBy).toHaveBeenCalledTimes(1);
    expect(map.panBy.mock.calls[0][0]).toEqual([200 - 416, 0]);
  });

  it('does not cut a flight to the marker short: it waits for it to land', async () => {
    const map = fakeMap({ x: 200, y: 400 }, true);
    fake.map = map;
    cardAt({ top: 12, right: 372 });
    open();
    await tick();
    expect(map.panBy).not.toHaveBeenCalled();
    map.moving = false;
    map.fire('moveend');
    expect(map.panBy).toHaveBeenCalledTimes(1);
  });

  it('a drag during the wait wins', async () => {
    const map = fakeMap({ x: 200, y: 400 }, true);
    fake.map = map;
    cardAt({ top: 12, right: 372 });
    open();
    await tick();
    map.moving = false;
    map.fire('moveend', { originalEvent: {} });
    expect(map.panBy).not.toHaveBeenCalled();
  });

  it('phone: measures the sheet where it ends up, not in the first frame of its slide', async () => {
    useUIStore.setState({ isMobile: true });
    const map = fakeMap({ x: 200, y: 617 });
    fake.map = map;
    const box = { top: 812, right: 375 };
    cardAt(box);
    let finish = () => {};
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations = () => [{ finished }];
    open();
    await tick();
    expect(map.panBy).not.toHaveBeenCalled();
    box.top = 260;
    finish();
    await tick();
    expect(map.panBy).toHaveBeenCalledTimes(1);
    expect(map.panBy.mock.calls[0][0]).toEqual([0, 617 - 130]);
  });

  it('a shared link: looks again when the first camera arrives with the load', async () => {
    const map = fakeMap({ x: 600, y: 400 });
    fake.map = map;
    cardAt({ top: 12, right: 372 });
    open();
    await tick();
    expect(map.panBy).not.toHaveBeenCalled();
    map.project = () => ({ x: 200, y: 400 });
    map.fire('load');
    expect(map.panBy).toHaveBeenCalledTimes(1);
  });

  it('does not pan after it closed', async () => {
    const map = fakeMap({ x: 200, y: 400 }, true);
    fake.map = map;
    cardAt({ top: 12, right: 372 });
    const { unmount } = open();
    await tick();
    unmount();
    map.moving = false;
    map.fire('moveend');
    expect(map.panBy).not.toHaveBeenCalled();
  });
});

describe('panToClearCard', () => {
  const card = { top: 300, right: 372 };
  const frame = { width: 1000, height: 700 };

  it('leaves the map alone when the marker is already clear', () => {
    expect(panToClearCard({ x: 600, y: 400 }, card, frame, 'right')).toEqual({ x: 0, y: 0 });
    expect(panToClearCard({ x: 100, y: 100 }, card, frame, 'above')).toEqual({ x: 0, y: 0 });
  });

  it('beside the card: moves the marker out to its right (negative pans the view left)', () => {
    expect(panToClearCard({ x: 200, y: 400 }, card, frame, 'right')).toEqual({ x: 200 - (372 + 44), y: 0 });
  });

  it('beside the card: brings back a marker out of the frame, above, below or to the right', () => {
    expect(panToClearCard({ x: 600, y: -65 }, card, frame, 'right')).toEqual({ x: 0, y: -65 - 44 });
    expect(panToClearCard({ x: 600, y: 690 }, card, frame, 'right')).toEqual({ x: 0, y: 690 - (700 - 76) });
    expect(panToClearCard({ x: 990, y: 400 }, card, frame, 'right')).toEqual({ x: 990 - 956, y: 0 });
  });

  it('over the card: takes the marker from under it to the middle of what is left', () => {
    expect(panToClearCard({ x: 200, y: 500 }, card, frame, 'above')).toEqual({ x: 0, y: 500 - 150 });
  });

  it('over the card: brings back a marker out of the frame', () => {
    expect(panToClearCard({ x: 200, y: -20 }, card, frame, 'above')).toEqual({ x: 0, y: -20 - 150 });
    expect(panToClearCard({ x: -30, y: 100 }, card, frame, 'above')).toEqual({ x: -30 - 500, y: 0 });
  });
});
