import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { NormalizedStation, NormalizedReading } from '../../types/station';

const map = { getZoom: () => 8, on: vi.fn(), off: vi.fn(), flyTo: vi.fn(), getCanvas: () => ({ style: {} }) };

vi.mock('react-map-gl/maplibre', () => ({
  Source: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Layer: () => null,
  Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ current: { getMap: () => map } }),
}));

import { StationSymbolLayer } from './StationSymbolLayer';
import { useUIStore } from '../../store/uiStore';

const near = (id: string, lat: number): NormalizedStation => ({ id, name: id, source: 'meteogalicia', lat, lon: -8.6, altitude: 10 });
const stations = [near('mg_a', 42.3), near('mg_b', 42.301), near('mg_c', 42.302)];
const readings = new Map<string, NormalizedReading>();

function draw() {
  render(<StationSymbolLayer stations={stations} readings={readings} selectedStationId={null} onSelectStation={() => {}} zoomLevel={8} />);
  return screen.getByRole('button', { name: '3 estaciones' });
}

describe('station group', () => {
  beforeEach(() => { map.flyTo.mockClear(); });

  it('says how many, with no «Cluster» in its name', () => {
    expect(draw()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cluster/i })).toBeNull();
  });

  it('is a 40 px target on a desktop and 44 on a phone, drawn smaller inside', () => {
    useUIStore.setState({ isMobile: false });
    expect(draw().style.width).toBe('40px');
  });

  it('a phone gets 44 px', () => {
    useUIStore.setState({ isMobile: true });
    const b = draw();
    expect(b.style.width).toBe('44px');
    expect(b.style.height).toBe('44px');
    useUIStore.setState({ isMobile: false });
  });

  it('the number is at 13 px', () => {
    expect((draw().firstElementChild as HTMLElement).style.fontSize).toBe('13px');
  });

  it('flies in on a tap', () => {
    fireEvent.click(draw());
    expect(map.flyTo).toHaveBeenCalledTimes(1);
  });
});
