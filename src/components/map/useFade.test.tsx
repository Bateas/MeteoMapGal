import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFade } from './useFade';

describe('useFade', () => {
  let frames: FrameRequestCallback[];
  const run = (ms: number) => act(() => {
    for (let left = ms; left > 0; left -= 50) {
      vi.advanceTimersByTime(50);
      const due = frames;
      frames = [];
      for (const f of due) f(performance.now());
    }
  });

  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('forms in 2 s: halfway at one second, whole at two', () => {
    const { result } = renderHook(() => useFade(true));
    expect(result.current).toBe(0);
    run(1000);
    expect(result.current).toBeGreaterThan(0.3);
    expect(result.current).toBeLessThan(0.7);
    run(1100);
    expect(result.current).toBe(1);
  });

  it('lifts more slowly than it forms: still there at 2 s, gone at 5 s', () => {
    const { result, rerender } = renderHook(({ show }) => useFade(show), { initialProps: { show: true } });
    run(2100);
    rerender({ show: false });
    run(2000);
    expect(result.current).toBeGreaterThan(0.2);
    run(3200);
    expect(result.current).toBe(0);
  });

  it('with reduced motion there is no ramp: it is there, and it is gone', () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce') })) as never;
    try {
      const { result, rerender } = renderHook(({ show }) => useFade(show), { initialProps: { show: true } });
      expect(result.current).toBe(1);
      expect(frames).toHaveLength(0);
      rerender({ show: false });
      expect(result.current).toBe(0);
    } finally {
      window.matchMedia = real;
    }
  });
});
