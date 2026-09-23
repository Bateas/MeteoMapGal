/**
 * This history is asked for by the visitor's own browser, straight to the
 * provider's domain, so nothing of ours can cache it: the only thing that
 * decides what a crowd costs is how many distinct points we ask for. Measured
 * against the 545 stations in production on 23-sep, asking one point per
 * 1,1 km cell meant 143 requests per visitor in Rias; one point per model node
 * means 27. These tests pin that the grouping is by node and that we ask for
 * the node itself, not for a station that happens to sit in it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./openMeteoQueue', () => ({ openMeteoFetch: vi.fn() }));

import { openMeteoFetch } from './openMeteoQueue';
import { gridNode, historyGridKey, fetchOpenMeteoForStations } from './openMeteoClient';

/** An answer shaped like Open-Meteo's, with one hour in it. */
const answer = () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({
      hourly: {
        time: ['2026-09-23T08:00'],
        temperature_2m: [15.5],
        relative_humidity_2m: [70],
        wind_speed_10m: [3.2],
        wind_direction_10m: [220],
      },
    }),
  }) as unknown as Response;

const urlOf = (call: unknown[]) => String(call[0]);

beforeEach(() => {
  vi.mocked(openMeteoFetch).mockReset();
  vi.mocked(openMeteoFetch).mockResolvedValue(answer());
  sessionStorage.clear();
});

describe('gridNode', () => {
  it('snaps to the nearest node, not the one below', () => {
    // 42.38 is closer to 42.4 than to 42.3: flooring would move the point
    // eight kilometres inland.
    expect(gridNode(42.38, -8.74)).toEqual({ lat: 42.4, lon: -8.7 });
    expect(gridNode(42.31, -8.66)).toEqual({ lat: 42.3, lon: -8.7 });
  });

  it('leaves no floating point dust in the coordinates', () => {
    const n = gridNode(42.37, -8.723);
    expect(String(n.lat)).toBe('42.4');
    expect(String(n.lon)).toBe('-8.7');
  });

  it('gives two nearby stations the same key, and distant ones different keys', () => {
    expect(historyGridKey(42.31, -8.72, 24)).toBe(historyGridKey(42.33, -8.68, 24));
    expect(historyGridKey(42.31, -8.72, 24)).not.toBe(historyGridKey(42.55, -8.72, 24));
  });

  it('keeps the span in the key: 24 h and 6 h are different answers', () => {
    expect(historyGridKey(42.31, -8.72, 24)).not.toBe(historyGridKey(42.31, -8.72, 6));
  });
});

describe('fetchOpenMeteoForStations', () => {
  it('asks once per node however many stations sit in it', async () => {
    const stations = [
      { id: 'a', lat: 42.31, lon: -8.72 },
      { id: 'b', lat: 42.33, lon: -8.68 },
      { id: 'c', lat: 42.29, lon: -8.71 },
      { id: 'd', lat: 42.55, lon: -8.72 }, // another node
    ];
    await fetchOpenMeteoForStations(stations);
    expect(vi.mocked(openMeteoFetch)).toHaveBeenCalledTimes(2);
  });

  it('asks for the node, never for the coordinates of one of the stations', async () => {
    await fetchOpenMeteoForStations([{ id: 'a', lat: 42.3142, lon: -8.7231 }]);
    const url = urlOf(vi.mocked(openMeteoFetch).mock.calls[0]);
    expect(url).toContain('latitude=42.3');
    expect(url).toContain('longitude=-8.7');
    expect(url).not.toContain('42.3142');
    expect(url).not.toContain('-8.7231');
  });

  it('hands every station in the node its own readings', async () => {
    const readings = await fetchOpenMeteoForStations([
      { id: 'a', lat: 42.31, lon: -8.72 },
      { id: 'b', lat: 42.33, lon: -8.68 },
    ]);
    const ids = new Set(readings.map((r) => r.stationId));
    expect(ids).toEqual(new Set(['a', 'b']));
  });
});
