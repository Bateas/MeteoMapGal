/**
 * Keyboard access to the spot markers and user pins.
 *
 * The shared setup stubs Marker as `() => null`, which hides the real mechanism:
 * react-map-gl builds the wrapper <div> itself, portals the children into it,
 * and MapLibre's addTo() stamps role="button" + aria-label="Map marker" on that
 * wrapper when nothing else named it. So a screen reader heard eleven identical
 * "Map marker" buttons, none of them reachable with Tab. This file mocks Marker
 * the way the library behaves, so the wrapper is what gets asserted.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({ map: null as null | Record<string, unknown> }));

vi.mock('react-map-gl/maplibre', async () => {
  const React = await import('react');
  const { createPortal } = await import('react-dom');
  // Mirrors @vis.gl/react-maplibre Marker: wrapper created once outside the
  // React tree, ref handed the marker instance (layout phase), addTo() in a
  // passive effect that only fills role/aria-label when they are absent.
  const Marker = React.forwardRef<unknown, { children?: React.ReactNode; onClick?: (e: unknown) => void }>(
    function Marker({ children, onClick }, ref) {
      const el = React.useMemo(() => document.createElement('div'), []);
      const onClickRef = React.useRef(onClick);
      onClickRef.current = onClick;
      React.useImperativeHandle(ref, () => ({ getElement: () => el }), [el]);
      React.useEffect(() => {
        if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'Map marker');
        if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
        const onNativeClick = (e: MouseEvent) => onClickRef.current?.({ originalEvent: e });
        el.addEventListener('click', onNativeClick);
        document.body.appendChild(el);
        return () => { el.removeEventListener('click', onNativeClick); el.remove(); };
      }, [el]);
      return createPortal(children, el);
    },
  );
  return {
    Marker,
    useMap: () => ({ current: h.map ? { getMap: () => h.map } : null }),
  };
});

import { SpotMarkers } from './SpotMarker';
import { UserSpotMarkers } from './UserSpotMarkers';
import { useSpotStore } from '../../store/spotStore';
import { useUserSpotStore } from '../../store/userSpotStore';
import { useSectorStore } from '../../store/sectorStore';
import { SECTORS } from '../../config/sectors';

function useSector(id: string) {
  useSectorStore.setState({ activeSector: SECTORS.find((s) => s.id === id)! } as never);
}

beforeEach(() => {
  cleanup();
  h.map = null;
  useSector('rias');
  useSpotStore.getState().selectSpot('');
  useUserSpotStore.setState({ userSpots: [], scores: new Map(), selectedUserSpotId: null } as never);
});

describe('spot markers', () => {
  it('are named buttons, never the generic "Map marker"', () => {
    render(<SpotMarkers />);
    const btns = screen.getAllByRole('button', { name: /^Spot / });
    expect(btns.length).toBeGreaterThan(1);
    expect(screen.queryAllByRole('button', { name: 'Map marker' })).toHaveLength(0);
  });

  it('are reachable with Tab', () => {
    render(<SpotMarkers />);
    for (const btn of screen.getAllByRole('button', { name: /^Spot / })) {
      expect(btn.tabIndex).toBe(0);
    }
  });

  it('select the spot with Enter and with Space, cancelling both keys', () => {
    render(<SpotMarkers />);
    const btn = screen.getAllByRole('button', { name: /^Spot / })[0];

    // fireEvent returns false when the handler called preventDefault.
    expect(fireEvent.keyDown(btn, { key: 'Enter' })).toBe(false);
    const first = useSpotStore.getState().activeSpotId;
    expect(first).toBeTruthy();

    useSpotStore.getState().selectSpot('');
    expect(fireEvent.keyDown(btn, { key: ' ' })).toBe(false);
    expect(useSpotStore.getState().activeSpotId).toBe(first);
  });

  it('ignore other keys', () => {
    render(<SpotMarkers />);
    const btn = screen.getAllByRole('button', { name: /^Spot / })[0];
    expect(fireEvent.keyDown(btn, { key: 'a' })).toBe(true);
    expect(useSpotStore.getState().activeSpotId).toBe('');
  });

  it('still select on a mouse click', () => {
    render(<SpotMarkers />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Spot / })[0]);
    expect(useSpotStore.getState().activeSpotId).toBeTruthy();
  });
});

describe('spot clusters', () => {
  it('are one named tab stop that flies to the group on Enter', () => {
    const flyTo = vi.fn();
    // Zoom 7 is below CLUSTER_DISABLE_ZOOM, so the Rías spots group up.
    h.map = { getZoom: () => 7, on: vi.fn(), off: vi.fn(), flyTo };
    render(<SpotMarkers />);

    const clusters = screen.getAllByRole('button', { name: /^Grupo de \d+ spots; el peor, / });
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters[0].tabIndex).toBe(0);
    // One stop, not two: the named button is neither inside another button (the
    // old inner <button> sat in the "Map marker" wrapper) nor wrapping one.
    expect(clusters[0].parentElement?.closest('[role="button"], button')).toBeNull();
    expect(clusters[0].querySelector('button, [role="button"]')).toBeNull();

    fireEvent.keyDown(clusters[0], { key: 'Enter' });
    expect(flyTo).toHaveBeenCalledTimes(1);
  });
});

describe('user pins', () => {
  it('are named, reachable with Tab and selected with Enter', () => {
    useUserSpotStore.setState({
      userSpots: [{
        id: 'user-test-1',
        name: 'Mi sitio',
        center: [-8.75, 42.32],
        sectorId: 'rias',
        createdAt: Date.now(),
      }],
    } as never);
    render(<UserSpotMarkers />);

    const pin = screen.getByRole('button', { name: /^Mi sitio \(sin calibrar\)/ });
    expect(pin.tabIndex).toBe(0);
    expect(screen.queryAllByRole('button', { name: 'Map marker' })).toHaveLength(0);

    fireEvent.keyDown(pin, { key: 'Enter' });
    expect(useUserSpotStore.getState().selectedUserSpotId).toBe('user-test-1');
  });
});

describe('makeMarkerButton — map keys stay on the spot', () => {
  it('arrows and +/- on a focused marker do not reach the map container', async () => {
    const { makeMarkerButton } = await import('./markerA11y');
    const container = document.createElement('div');
    const el = document.createElement('div');
    container.appendChild(el);
    document.body.appendChild(container);
    const seen: string[] = [];
    container.addEventListener('keydown', (e) => seen.push(e.key));
    const onActivate = vi.fn();
    makeMarkerButton({ getElement: () => el } as never, 'Cesantes', onActivate);
    for (const key of ['ArrowLeft', 'ArrowUp', '+', '-']) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    expect(seen).toEqual([]);
    expect(onActivate).not.toHaveBeenCalled();
    // Other keys still bubble (Tab, Escape reach the page as before).
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(seen).toEqual(['Escape']);
    container.remove();
  });
});
