import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

type Handler = (ev?: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
let zoom = 10;
const fakeMap = {
  getZoom: () => zoom,
  on: (name: string, fn: Handler) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name)!.add(fn); },
  off: (name: string, fn: Handler) => { handlers.get(name)?.delete(fn); },
};
const fire = (name: string, ev?: unknown) => { for (const fn of handlers.get(name) ?? []) fn(ev); };

const sources: Array<{ minzoom?: number }> = [];
vi.mock('react-map-gl/maplibre', () => ({
  Source: (p: { minzoom?: number; children?: React.ReactNode }) => { sources.push(p); return <div data-testid="chart-source">{p.children}</div>; },
  Layer: () => null,
  useMap: () => ({ current: { getMap: () => fakeMap } }),
}));

import { NauticalChartOverlay, CHART_MIN_ZOOM } from './NauticalChartOverlay';
import { useMapStyleStore } from '../../store/mapStyleStore';

describe('NauticalChartOverlay', () => {
  beforeEach(() => {
    handlers.clear();
    sources.length = 0;
    zoom = 12;
    useMapStyleStore.setState({ showNauticalChart: true });
  });

  it('asks for no tiles below its zoom, and the map says why there is no chart', () => {
    zoom = CHART_MIN_ZOOM - 1;
    render(<NauticalChartOverlay />);
    expect(sources[0].minzoom).toBe(CHART_MIN_ZOOM);
    expect(screen.getByText(/acércate/)).toBeInTheDocument();

    zoom = CHART_MIN_ZOOM;
    act(() => fire('zoom'));
    expect(screen.queryByText(/acércate/)).toBeNull();
  });

  it('says so when the breaker takes it down, with the switch still on', () => {
    render(<NauticalChartOverlay />);
    expect(screen.getByTestId('chart-source')).toBeInTheDocument();
    expect(screen.queryByText(/sin servicio/)).toBeNull();

    act(() => { for (let i = 0; i < 6; i++) fire('error', { sourceId: 'ihm-enc' }); });
    expect(useMapStyleStore.getState().showNauticalChart).toBe(true);
    expect(screen.queryByTestId('chart-source')).toBeNull();
    expect(screen.getByText(/sin servicio/)).toBeInTheDocument();
  });

  it('draws and says nothing when it is off', () => {
    useMapStyleStore.setState({ showNauticalChart: false });
    const { container } = render(<NauticalChartOverlay />);
    expect(container).toBeEmptyDOMElement();
  });
});
