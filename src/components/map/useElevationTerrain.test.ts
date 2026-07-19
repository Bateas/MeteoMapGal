/**
 * Tests for useElevationTerrain — the on-demand terrain that keeps
 * queryTerrainElevation answering on a flat 2D map.
 *
 * This is the risky part of going 2D: if terrain never turns on, the AEMET
 * halo silently renders nothing and the fog blobs over-paint. If it never
 * turns off, we pay the terrain render pass forever and lose the whole point.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useElevationTerrain } from './useElevationTerrain';

type FakeMap = {
  setTerrain: ReturnType<typeof vi.fn>;
  getTerrain: ReturnType<typeof vi.fn>;
  isStyleLoaded: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  /** Fire a map event, like MapLibre would. */
  emit: (event: string) => void;
  /** Simulate setStyle(): MapLibre drops the terrain setting on a style swap. */
  wipeStyle: () => void;
};

function makeMap(styleLoaded = true): { map: FakeMap; ref: { getMap: () => FakeMap } } {
  let terrain: unknown = null;
  const handlers = new Map<string, Set<() => void>>();

  const map: FakeMap = {
    setTerrain: vi.fn((spec: unknown) => { terrain = spec; }),
    getTerrain: vi.fn(() => terrain),
    isStyleLoaded: vi.fn(() => styleLoaded),
    on: vi.fn((event: string, fn: () => void) => {
      const set = handlers.get(event) ?? new Set();
      set.add(fn);
      handlers.set(event, set);
    }),
    off: vi.fn((event: string, fn: () => void) => { handlers.get(event)?.delete(fn); }),
    emit: (event) => { for (const fn of handlers.get(event) ?? []) fn(); },
    wipeStyle: () => { terrain = null; },
  };
  return { map, ref: { getMap: () => map } };
}

describe('useElevationTerrain', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enables terrain on mount so elevation queries work', () => {
    const { map, ref } = makeMap();
    renderHook(() => useElevationTerrain(ref as never));

    expect(map.setTerrain).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'terrainDEM' }),
    );
  });

  it('keeps exaggeration at 1.2 — fog thresholds were calibrated on it', () => {
    const { map, ref } = makeMap();
    renderHook(() => useElevationTerrain(ref as never));

    expect(map.setTerrain).toHaveBeenCalledWith(
      expect.objectContaining({ exaggeration: 1.2 }),
    );
  });

  it('disables terrain when the last consumer unmounts', () => {
    const { map, ref } = makeMap();
    const { unmount } = renderHook(() => useElevationTerrain(ref as never));
    unmount();

    expect(map.setTerrain).toHaveBeenLastCalledWith(null);
  });

  it('refcounts: two consumers enable once, and only the last one turns it off', () => {
    const { map, ref } = makeMap();
    const a = renderHook(() => useElevationTerrain(ref as never));
    const b = renderHook(() => useElevationTerrain(ref as never));

    // Enabled a single time despite two consumers
    const enables = map.setTerrain.mock.calls.filter((c) => c[0] !== null);
    expect(enables).toHaveLength(1);

    a.unmount();
    expect(map.setTerrain).not.toHaveBeenLastCalledWith(null); // still needed by b

    b.unmount();
    expect(map.setTerrain).toHaveBeenLastCalledWith(null);
  });

  it('waits for the style before touching terrain, then enables on style.load', () => {
    const { map, ref } = makeMap(false); // style not loaded yet
    renderHook(() => useElevationTerrain(ref as never));

    expect(map.setTerrain).not.toHaveBeenCalled();
    // 'style.load', not 'load': these consumers are lazy and mount late, so a
    // one-shot 'load' may already be spent and would never fire again.
    expect(map.on).toHaveBeenCalledWith('style.load', expect.any(Function));

    map.emit('style.load');
    expect(map.setTerrain).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'terrainDEM' }),
    );
  });

  it('re-enables terrain after a style swap wipes it', () => {
    const { map, ref } = makeMap();
    renderHook(() => useElevationTerrain(ref as never));

    map.wipeStyle(); // setStyle() (base map / sector switch) drops the terrain
    map.emit('style.load');

    expect(map.setTerrain).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'terrainDEM' }),
    );
  });

  it('stops listening on unmount, so style.load cannot resurrect terrain', () => {
    const { map, ref } = makeMap();
    const { unmount } = renderHook(() => useElevationTerrain(ref as never));
    unmount();

    expect(map.off).toHaveBeenCalledWith('style.load', expect.any(Function));

    map.emit('style.load');
    expect(map.setTerrain).toHaveBeenLastCalledWith(null);
  });

  it('one consumer unmounting leaves the survivor still listening for style.load', () => {
    const { map, ref } = makeMap();
    const a = renderHook(() => useElevationTerrain(ref as never));
    const b = renderHook(() => useElevationTerrain(ref as never));

    a.unmount(); // b still needs elevation
    map.wipeStyle();
    map.emit('style.load');

    expect(map.setTerrain).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'terrainDEM' }),
    );
    b.unmount();
  });

  it('is a no-op without a map', () => {
    expect(() => renderHook(() => useElevationTerrain(undefined))).not.toThrow();
  });
});
