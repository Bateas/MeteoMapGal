/**
 * The radar adds its source and layer by hand. While a style is loading, MapLibre throws
 * «Style is not done loading»; uncaught, it took the whole map to its error screen (production,
 * 29-oct, radar on). The installer has to wait for the style instead.
 */
import { describe, it, expect, vi } from 'vitest';
import { installRadarLayer } from './RadarOverlay';

function fakeMap(addSourceError?: Error) {
  const sources = new Map<string, unknown>();
  return {
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string, spec: unknown) => {
      if (addSourceError) throw addSourceError;
      sources.set(id, spec);
    }),
    addLayer: vi.fn(),
  };
}

const url = 'https://tilecache.rainviewer.com/v2/radar/abc/256/{z}/{x}/{y}/2/0_0.png';

describe('installRadarLayer', () => {
  it('adds the source and the layer once', () => {
    const map = fakeMap();
    expect(installRadarLayer(map as never, url, 0.7)).toBe(true);
    expect(installRadarLayer(map as never, url, 0.7)).toBe(true);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
  });

  it('waits, without throwing, while the style is still loading', () => {
    const map = fakeMap(new Error('Style is not done loading.'));
    expect(() => installRadarLayer(map as never, url, 0.7)).not.toThrow();
    expect(installRadarLayer(map as never, url, 0.7)).toBe(false);
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it('still throws any other error, so a real bug is not hidden', () => {
    const map = fakeMap(new Error('Source "x" already exists'));
    expect(() => installRadarLayer(map as never, url, 0.7)).toThrow(/already exists/);
  });
});
