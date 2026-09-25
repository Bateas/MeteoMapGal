import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/stationListClient', () => ({ fetchListedStations: vi.fn() }));
vi.mock('../api/buoyClient', () => ({ fetchStoredBuoys: vi.fn() }));
vi.mock('../api/historyClient', async () => {
  const actual = await vi.importActual<typeof import('../api/historyClient')>('../api/historyClient');
  return { ...actual, fetchLatestReadings: vi.fn() };
});

import { loadWidgetInputs } from './widgetData';
import { fetchListedStations } from '../api/stationListClient';
import { fetchStoredBuoys } from '../api/buoyClient';
import { fetchLatestReadings } from '../api/historyClient';

const station = { id: 'mg_14001', source: 'meteogalicia' as const, name: 'Porto de Vigo', lat: 42.24, lon: -8.73, altitude: 7 };
const row = {
  time: '2026-09-25T17:00:00Z', station_id: 'mg_14001', source: 'meteogalicia',
  temperature: 21, humidity: 70, wind_speed: 6, wind_gust: 8, wind_dir: 250,
  pressure: 1016, dew_point: 15, precip: 0, solar_rad: 300,
};

describe('loadWidgetInputs', () => {
  beforeEach(() => {
    vi.mocked(fetchListedStations).mockResolvedValue([station]);
    vi.mocked(fetchLatestReadings).mockResolvedValue([row]);
    vi.mocked(fetchStoredBuoys).mockReset().mockResolvedValue([]);
  });

  it('builds the engine inputs from our own API: list, latest readings and buoys', async () => {
    const { stations, readings, buoys } = await loadWidgetInputs(true);
    expect(stations).toEqual([station]);
    expect(readings.get('mg_14001')).toMatchObject({ windSpeed: 6, windDirection: 250, temperature: 21 });
    expect(buoys).toEqual([]);
    expect(fetchLatestReadings).toHaveBeenCalledWith(); // every source in one request
    expect(fetchStoredBuoys).toHaveBeenCalledTimes(1);
  });

  it('does not ask for buoys inland', async () => {
    await loadWidgetInputs(false);
    expect(fetchStoredBuoys).not.toHaveBeenCalled();
  });

  it('scores without buoys when only the buoys fail', async () => {
    vi.mocked(fetchStoredBuoys).mockRejectedValue(new Error('502'));
    expect((await loadWidgetInputs(true)).buoys).toEqual([]);
  });

  it('fails when there is no station list to score with', async () => {
    vi.mocked(fetchListedStations).mockResolvedValue(null);
    await expect(loadWidgetInputs(true)).rejects.toThrow();
  });
});
