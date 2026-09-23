/**
 * Reading the buoys from our own service instead of asking Puertos del Estado
 * once per station, per tab, per cycle. The map must show exactly the same
 * numbers it showed before, so this pins the translation field by field: a
 * wrong name here does not throw, it just makes a value disappear from the
 * popup and from the verdict.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./fetchWithRetry', () => ({ fetchWithRetry: vi.fn() }));

import { fetchWithRetry } from './fetchWithRetry';
import { fetchStoredBuoys, storedRowToReading } from './buoyClient';

/** A row exactly as /api/v1/buoys/latest serves it (Cortegada, 23-sep). */
const ROW = {
  time: '2026-09-23 08:40:00+02',
  station_id: 1250,
  station_name: 'Cortegada (Arousa)',
  source: 'obscosteiro',
  wave_height: 0.4,
  wave_height_max: 0.7,
  wave_period: 6.1,
  wave_period_mean: 4.2,
  wave_dir: 275,
  wind_speed: 7.86,
  wind_dir: 56,
  wind_gust: 10.2,
  water_temp: 16.746,
  air_temp: 18.59,
  air_pressure: 1016.2,
  current_speed: 0.12,
  current_dir: 190,
  salinity: 32.354,
  sea_level: 2.61,
  humidity: 69,
  dew_point: 12.86,
};

const ok = (readings: unknown[]) =>
  ({ ok: true, status: 200, json: async () => ({ count: readings.length, readings }) }) as unknown as Response;

describe('buoys from our own service', () => {
  beforeEach(() => vi.mocked(fetchWithRetry).mockReset());

  it('carries every field the map and the verdict read', () => {
    const r = storedRowToReading(ROW);
    expect(r).toEqual({
      stationId: 1250,
      stationName: 'Cortegada (Arousa)',
      timestamp: '2026-09-23T06:40:00.000Z',
      waveHeight: 0.4,
      waveHeightMax: 0.7,
      wavePeriod: 6.1,
      wavePeriodMean: 4.2,
      waveDir: 275,
      windSpeed: 7.86,
      windDir: 56,
      windGust: 10.2,
      waterTemp: 16.746,
      airTemp: 18.59,
      airPressure: 1016.2,
      currentSpeed: 0.12,
      currentDir: 190,
      salinity: 32.354,
      seaLevel: 2.61,
      humidity: 69,
      dewPoint: 12.86,
      source: 'obscosteiro',
    });
  });

  it('keeps the moment the reading was taken, offset included', () => {
    // Stored as "2026-09-23 08:40:00+02": 08:40 in Galicia, not 08:40 UTC.
    expect(new Date(storedRowToReading(ROW).timestamp).getTime())
      .toBe(Date.parse('2026-09-23T06:40:00Z'));
  });

  it('a missing value stays missing instead of turning into zero', () => {
    const empty = { ...ROW, wave_height: null, wind_speed: null, sea_level: null };
    const r = storedRowToReading(empty);
    expect(r.waveHeight).toBeNull();
    expect(r.windSpeed).toBeNull();
    expect(r.seaLevel).toBeNull();
  });

  it('anything not from the coastal observatory counts as Puertos del Estado', () => {
    expect(storedRowToReading({ ...ROW, source: 'portus' }).source).toBe('portus');
    expect(storedRowToReading({ ...ROW, source: null }).source).toBe('portus');
  });

  it('one request brings them all', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(ok([ROW, { ...ROW, station_id: 3221, source: 'portus' }]));
    const buoys = await fetchStoredBuoys();
    expect(buoys.map((b) => b.stationId)).toEqual([1250, 3221]);
    expect(vi.mocked(fetchWithRetry)).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetchWithRetry).mock.calls[0][0])).toBe('/api/v1/buoys/latest');
  });

  it('fails loudly when our service does not answer, so the caller can ask the providers', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as unknown as Response);
    await expect(fetchStoredBuoys()).rejects.toThrow(/503/);
  });

  it('an empty answer is not a failure: the caller decides what to do with none', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(ok([]));
    await expect(fetchStoredBuoys()).resolves.toEqual([]);
  });
});
