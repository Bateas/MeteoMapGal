/**
 * The centre of a station says its temperature: a cold zone is bluer, without saying it. The layer only points at
 * `tempColor`, so this reads the features it hands to the map: a station with every centre grey is the washed-out map
 * rejected on 5-nov, and nothing else would notice it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { FeatureCollection } from 'geojson';

const h = vi.hoisted(() => ({ data: null as unknown }));

vi.mock('react-map-gl/maplibre', () => ({
  Source: ({ id, data, children }: { id: string; data: unknown; children?: unknown }) => {
    if (id === 'stations-geo') h.data = data;
    return children;
  },
  Layer: () => null,
  Marker: () => null,
  useMap: () => ({ current: { getMap: () => ({ getZoom: () => 13, on: vi.fn(), off: vi.fn(), flyTo: vi.fn() }) } }),
}));

import { StationSymbolLayer, clusterFill } from './StationSymbolLayer';
import { temperatureColor } from '../../services/windUtils';
import type { NormalizedReading, NormalizedStation } from '../../types/station';

const station = (id: string, lat: number): NormalizedStation => ({ id, name: id, source: 'meteogalicia', lat, lon: -8.6, altitude: 10 } as NormalizedStation);
const reading = (stationId: string, temperature: number | null): NormalizedReading => ({
  stationId, timestamp: new Date(), temperature, humidity: 70, pressure: 1015, windSpeed: 4, windGust: 6, windDirection: 90,
  precipitation: 0, solarRadiation: null, dewPoint: null,
});

function colours(readings: NormalizedReading[]) {
  const stations = readings.map((r, i) => station(r.stationId, 42 + i * 0.2));
  h.data = null;
  render(
    <StationSymbolLayer stations={stations} readings={new Map(readings.map((r) => [r.stationId, r]))} selectedStationId={null} onSelectStation={() => {}} zoomLevel={13} />,
  );
  const byId = new Map<string, string>();
  for (const f of (h.data as FeatureCollection).features) byId.set(f.properties!.id ?? f.properties!.stationId, f.properties!.tempColor);
  return byId;
}

afterEach(cleanup);

describe('the centre of a station', () => {
  it('a cold one and a warm one are not the same colour, and each is the colour of its temperature', () => {
    const c = colours([reading('mg_cold', 3), reading('mg_warm', 27)]);
    expect(c.get('mg_cold')).toBe(temperatureColor(3));
    expect(c.get('mg_warm')).toBe(temperatureColor(27));
    expect(c.get('mg_cold')).not.toBe(c.get('mg_warm'));
  });

  it('with no temperature it says nothing: the grey of no data', () => {
    expect(colours([reading('mg_none', null)]).get('mg_none')).toBe(temperatureColor(null));
  });
});

describe('a group of stations', () => {
  it('takes the temperature of its zone, softened', () => {
    expect(clusterFill(3)).toContain(temperatureColor(3));
    expect(clusterFill(27)).toContain(temperatureColor(27));
    expect(clusterFill(3)).not.toBe(clusterFill(27));
    expect(clusterFill(27)).toContain('var(--g-bg)');
  });

  it('with no temperature, the paper', () => {
    expect(clusterFill(null)).toBe('var(--g-bg)');
  });
});
