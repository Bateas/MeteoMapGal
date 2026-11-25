import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

/**
 * A station's centre is its temperature and its ring its network; in simple mode it is also smaller and fainter. The
 * layers are MapLibre paint expressions, so the test captures what each <Layer> receives.
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
    <StationSymbolLayer stations={[]} readings={new Map()} selectedStationId={null} onSelectStation={() => {}} zoomLevel={11} hideSourceLabels={muted} faint={muted} />,
  );
}

describe('StationSymbolLayer: colour and weight', () => {
  beforeEach(() => layers.clear());

  it('the centre is its temperature, in both modes', () => {
    for (const simple of [true, false]) {
      draw(simple);
      expect(layers.get('stations-icons')?.paint?.['icon-color']).toEqual(['get', 'tempColor']);
    }
  });

  it('the ring is its network in advanced mode, where the initials say it, and neutral in simple', () => {
    draw(false);
    expect(layers.get('stations-source-ring')?.paint?.['circle-stroke-color']).toEqual(['get', 'sourceColor']);
    draw(true);
    expect(layers.get('stations-source-ring')?.paint?.['circle-stroke-color']).toBe('#8a928e');
  });

  it('simple mode: the freshness fade is scaled down, so the spots lead', () => {
    draw(true);
    const op = layers.get('stations-icons')?.paint?.['icon-opacity'] as unknown[];
    expect(op[0]).toBe('*');
    expect(op[1]).toBeLessThan(1);
  });

  it('advanced mode: freshness alone', () => {
    draw(false);
    const op = layers.get('stations-icons')?.paint?.['icon-opacity'] as unknown[];
    expect(op[0]).toBe('step');
  });
});
