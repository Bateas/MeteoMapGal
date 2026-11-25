/**
 * The long label of a silent buoy («sin dato desde las 10:45») sat over the buoy, and a spot marker beside it cut
 * it: symbols draw under the markers (25-nov, the Vigo tide gauge under the Bocana marker). The label goes to the
 * side with no spot on it. The style expressions are checked against the MapLibre spec: a wrong one fails without
 * a word and the label just does not draw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';

interface Captured { id?: string; layout?: Record<string, unknown>; paint?: Record<string, unknown>; data?: GeoJSON.FeatureCollection }
const seen: Captured[] = [];

vi.mock('react-map-gl/maplibre', () => ({
  useMap: () => ({ current: null }),
  Source: (props: { data: GeoJSON.FeatureCollection; children?: unknown }) => { seen.push({ data: props.data }); return props.children ?? null; },
  Layer: (props: Captured) => { seen.push({ id: props.id, layout: props.layout, paint: props.paint }); return null; },
}));
vi.mock('../../hooks/useMapInk', () => ({ useMapInk: () => ({ text: '#111111', halo: '#ffffff' }) }));

import { BuoySymbolLayer } from './BuoySymbolLayer';
import { useSectorStore } from '../../store/sectorStore';
import { SECTORS } from '../../config/sectors';
import type { BuoyReading } from '../../api/buoyClient';

const VIGO_GAUGE = 3221;

function buoy(stationId: number, ageMin: number): BuoyReading {
  return { stationId, stationName: `B${stationId}`, timestamp: new Date(Date.now() - ageMin * 60_000).toISOString(), waveHeight: 1.2, waterTemp: 15 } as unknown as BuoyReading;
}

function features(): GeoJSON.Feature[] {
  return seen.find((s) => s.data)?.data?.features ?? [];
}

beforeEach(() => {
  seen.length = 0;
  useSectorStore.setState({ activeSector: SECTORS.find((s) => s.id === 'rias')! });
});
afterEach(cleanup);

describe('the label of a silent buoy', () => {
  it('goes to the side with no spot marker: the Vigo tide gauge, with Bocana to its east', () => {
    render(<BuoySymbolLayer buoys={[buoy(VIGO_GAUGE, 600)]} selectedBuoyId={null} onSelectBuoy={() => {}} />);
    const f = features()[0];
    expect(String(f.properties?.waveLabel)).toMatch(/^sin dato desde/);
    expect(f.properties?.labelSide).toBe('left');
  });

  it('a buoy that reports keeps its short label over it', () => {
    render(<BuoySymbolLayer buoys={[buoy(VIGO_GAUGE, 5)]} selectedBuoyId={null} onSelectBuoy={() => {}} />);
    const f = features()[0];
    expect(f.properties?.waveLabel).toBe('1,2 m');
    expect(f.properties?.labelSide).toBe('above');
  });

  it('the layer places the label by that side, with expressions MapLibre accepts', () => {
    render(<BuoySymbolLayer buoys={[buoy(VIGO_GAUGE, 600)]} selectedBuoyId={null} onSelectBuoy={() => {}} />);
    const labels = seen.find((s) => s.id === 'buoys-labels');
    expect(JSON.stringify(labels?.layout?.['text-offset'])).toContain('labelSide');
    expect(JSON.stringify(labels?.layout?.['text-anchor'])).toContain('labelSide');
    const style = {
      version: 8,
      glyphs: 'https://example.test/{fontstack}/{range}.pbf',
      sources: { buoys: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: [{ id: 'buoys-labels', type: 'symbol', source: 'buoys', layout: labels?.layout, paint: labels?.paint }],
    };
    expect(validateStyleMin(style as Parameters<typeof validateStyleMin>[0]).map((e) => e.message)).toEqual([]);
  });
});
