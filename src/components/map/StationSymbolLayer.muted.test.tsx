import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

/**
 * In simple mode the stations recede so the spots lead: neutral grey instead of
 * the temperature fill and the per-source ring, smaller, fainter. The layers are
 * MapLibre paint expressions, so the test captures what each <Layer> receives.
 */
const layers = vi.hoisted(() => new Map<string, { paint?: Record<string, unknown>; layout?: Record<string, unknown> }>());

vi.mock('react-map-gl/maplibre', () => ({
  Source: ({ children }: { children?: unknown }) => children,
  Layer: (p: { id: string; paint?: Record<string, unknown>; layout?: Record<string, unknown> }) => {
    layers.set(p.id, p);
    return null;
  },
  Marker: () => null,
  useMap: () => ({ current: null }),
}));

import { StationSymbolLayer } from './StationSymbolLayer';

function draw(muted: boolean) {
  cleanup();
  layers.clear();
  render(
    <StationSymbolLayer stations={[]} readings={new Map()} selectedStationId={null} onSelectStation={() => {}} zoomLevel={11} hideSourceLabels={muted} muted={muted} />,
  );
}

describe('StationSymbolLayer — muted in simple mode', () => {
  beforeEach(() => layers.clear());

  it('grey ring and grey fill instead of the source and temperature colours', () => {
    draw(true);
    expect(layers.get('stations-source-ring')?.paint?.['circle-stroke-color']).toBe('#94a3b8');
    expect(layers.get('stations-icons')?.paint?.['icon-color']).toBe('#94a3b8');
  });

  it('fainter: the freshness fade is scaled down', () => {
    draw(true);
    const op = layers.get('stations-icons')?.paint?.['icon-opacity'] as unknown[];
    expect(op[0]).toBe('*');
    expect(op[1]).toBeLessThan(1);
  });

  it('advanced mode keeps the source ring and the temperature fill', () => {
    draw(false);
    expect(layers.get('stations-source-ring')?.paint?.['circle-stroke-color']).toEqual(['get', 'sourceColor']);
    expect(layers.get('stations-icons')?.paint?.['icon-color']).toEqual(['get', 'tempColor']);
  });
});
