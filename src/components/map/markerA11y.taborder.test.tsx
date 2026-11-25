/**
 * The first Tab on the map went to the first spot of the list, wherever the map was looking: MapLibre appends each
 * marker as it mounts, so the document order is the order of the list (25-nov: always Castrelo inland and Cesantes
 * on the coast, even when not centred). The markers take the order of what is in view when the Tab key is pressed.
 * jsdom lays nothing out: each marker is given its box by hand.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { tabOrder, orderMarkersForTab } from './markerA11y';
import { useMarkerTabOrder } from './useMarkerTabOrder';

afterEach(() => { cleanup(); document.body.replaceChildren(); });

const BOX = { width: 800, height: 600 };

function rect(x: number, y: number, w = 0, h = 0): DOMRect {
  return { x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) } as DOMRect;
}

/**
 * A map box with markers at the given centres; `tab: false` makes one that the keyboard does not reach.
 * As in a browser, the box that holds the markers has no size of its own: the canvas has the size of the view.
 */
function mapWith(spots: { name: string; x: number; y: number; tab?: boolean }[]): HTMLElement {
  const box = document.createElement('div');
  box.className = 'maplibregl-canvas-container';
  box.getBoundingClientRect = () => rect(0, 0, 0, 0);
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => rect(0, 0, BOX.width, BOX.height);
  box.append(canvas);
  for (const s of spots) {
    const el = document.createElement('div');
    el.className = 'maplibregl-marker';
    el.dataset.name = s.name;
    if (s.tab !== false) el.tabIndex = 0;
    el.getBoundingClientRect = () => rect(s.x, s.y);
    box.append(el);
  }
  document.body.append(box);
  return box;
}
const names = (box: HTMLElement) => Array.from(box.querySelectorAll<HTMLElement>('.maplibregl-marker')).map((m) => m.dataset.name);

describe('the order of the Tab key over the markers', () => {
  it('what is in view goes first, the nearest to the centre leading; the rest keeps its place after', () => {
    const order = tabOrder(
      [
        { item: 'fuera-1', x: -50, y: 300 },
        { item: 'esquina', x: 780, y: 20 },
        { item: 'centro', x: 410, y: 290 },
        { item: 'fuera-2', x: 400, y: 900 },
        { item: 'medio', x: 250, y: 300 },
      ],
      BOX,
    );
    expect(order).toEqual(['centro', 'medio', 'esquina', 'fuera-1', 'fuera-2']);
  });

  it('two markers at the same distance keep the order they came in', () => {
    expect(tabOrder([{ item: 'a', x: 300, y: 300 }, { item: 'b', x: 500, y: 300 }], BOX)).toEqual(['a', 'b']);
  });
});

describe('the markers of the map, in the document', () => {
  it('take that order, behind the canvas and whatever the keyboard does not reach', () => {
    const box = mapWith([
      { name: 'cesantes', x: 2000, y: 300 },
      { name: 'regla', x: 100, y: 100, tab: false },
      { name: 'patos', x: 700, y: 500 },
      { name: 'bocana', x: 400, y: 300 },
    ]);
    expect(orderMarkersForTab(box)).toBe(true);
    expect(box.firstElementChild?.tagName).toBe('CANVAS');
    expect(names(box)).toEqual(['regla', 'bocana', 'patos', 'cesantes']);
  });

  it('nothing is touched when the order is already right', () => {
    const box = mapWith([{ name: 'bocana', x: 400, y: 300 }, { name: 'patos', x: 700, y: 500 }]);
    const before = Array.from(box.children);
    expect(orderMarkersForTab(box)).toBe(false);
    expect(Array.from(box.children)).toEqual(before);
  });

  it('nothing moves while a marker holds the focus: the reader is in the middle of the row', () => {
    const box = mapWith([{ name: 'cesantes', x: 2000, y: 300 }, { name: 'bocana', x: 400, y: 300 }]);
    box.querySelector<HTMLElement>('[data-name="cesantes"]')?.focus();
    expect(orderMarkersForTab(box)).toBe(false);
    expect(names(box)).toEqual(['cesantes', 'bocana']);
  });

  it('no map, or a map with no markers, does not break', () => {
    expect(orderMarkersForTab(null)).toBe(false);
    expect(orderMarkersForTab(mapWith([]))).toBe(false);
  });
});

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  useMarkerTabOrder(ref);
  return <div ref={ref} data-testid="mapbox" />;
}

describe('the Tab key on the page', () => {
  it('puts the markers in order before the focus moves; other keys leave them alone', () => {
    const view = render(<Harness />);
    const box = mapWith([{ name: 'cesantes', x: 2000, y: 300 }, { name: 'bocana', x: 400, y: 300 }]);
    view.getByTestId('mapbox').append(box);
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(names(box)).toEqual(['cesantes', 'bocana']);
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(names(box)).toEqual(['bocana', 'cesantes']);
  });
});
