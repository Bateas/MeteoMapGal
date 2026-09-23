/**
 * The air-quality halo used to repaint its full-screen canvas on every `move`
 * event while panning (~60 per second), reallocating the backing store each
 * time. Unnoticeable on a big GPU, a stuttering pan on a modest laptop. It
 * must follow the map with a transform while moving and repaint only when the
 * movement ends.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { IcaOverlay } from './IcaOverlay';
import { useIcaStore } from '../../store/icaStore';

type Handler = () => void;

function fakeMap() {
  const handlers = new Map<string, Set<Handler>>();
  const view = { lng: -8.7, lat: 42.2, zoom: 10, bearing: 0, dx: 0 };
  const map = {
    view,
    on: (ev: string, fn: Handler) => { (handlers.get(ev) ?? handlers.set(ev, new Set()).get(ev)!).add(fn); },
    off: (ev: string, fn: Handler) => { handlers.get(ev)?.delete(fn); },
    fire: (ev: string) => { for (const fn of handlers.get(ev) ?? []) fn(); },
    project: (ll: [number, number] | { lng: number; lat: number }) => {
      const [lng, lat] = Array.isArray(ll) ? ll : [ll.lng, ll.lat];
      return { x: 400 + (lng - view.lng) * 1000 + view.dx, y: 300 - (lat - view.lat) * 1000 };
    },
    getCenter: () => ({ lng: view.lng, lat: view.lat }),
    getZoom: () => view.zoom,
    getBearing: () => view.bearing,
  };
  return map;
}

describe('IcaOverlay — no repaint per frame while the map moves', () => {
  let ctx: Record<string, ReturnType<typeof vi.fn>>;
  // Frames run when the test says, as the browser runs them after the event.
  let frames: FrameRequestCallback[] = [];
  const flushFrames = () => { const f = frames; frames = []; f.forEach((cb) => cb(0)); };

  beforeEach(() => {
    ctx = {
      clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), scale: vi.fn(),
      beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), rect: vi.fn(),
      fillText: vi.fn(), roundRect: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      measureText: vi.fn(() => ({ width: 60 })),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    useIcaStore.getState().setReadings([
      { station: 'Vigo', ica: 3.4, dominantPollutant: 'PM10', categoryEs: 'Deficiente', color: '#f97316',
        lat: 42.23, lon: -8.72, timestamp: new Date() },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useIcaStore.getState().clear();
  });

  it('follows the map with a transform while moving, and repaints on moveend', () => {
    const map = fakeMap();
    const mapRef = { current: { getMap: () => map } } as never;
    const { container } = render(<IcaOverlay mapRef={mapRef} />);
    const canvas = container.querySelector('canvas')!;

    const paintsAfterMount = ctx.clearRect.mock.calls.length;
    expect(paintsAfterMount).toBeGreaterThan(0);

    act(() => {
      for (let i = 1; i <= 30; i++) { map.view.dx = i * 5; map.fire('move'); if (i % 3 === 0) flushFrames(); }
    });
    expect(ctx.clearRect.mock.calls.length).toBe(paintsAfterMount);
    expect(canvas.style.transform).toContain('translate(150px, 0px)');

    act(() => map.fire('moveend'));
    expect(ctx.clearRect.mock.calls.length).toBe(paintsAfterMount + 1);
    expect(canvas.style.transform).toBe('');
  });

  it('hides the painting during a rotation instead of misplacing it', () => {
    const map = fakeMap();
    const mapRef = { current: { getMap: () => map } } as never;
    const { container } = render(<IcaOverlay mapRef={mapRef} />);
    const canvas = container.querySelector('canvas')!;

    act(() => { map.view.bearing = 15; map.fire('move'); flushFrames(); });
    expect(canvas.style.opacity).toBe('0');

    act(() => map.fire('moveend'));
    expect(canvas.style.opacity).toBe('');
  });
});
