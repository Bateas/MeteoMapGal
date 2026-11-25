/**
 * The loading screen never stays on: it leaves with the first readings, with an error, or at its time limit.
 * And its bar only reports what has happened.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { LoadingScreen, loadProgress, MAX_WAIT_MS } from './LoadingScreen';
import { useWeatherStore } from '../../store/weatherStore';
import type { NormalizedReading, NormalizedStation } from '../../types/station';

const screenOf = (container: HTMLElement) => container.querySelector('.gc-boot') as HTMLElement;

beforeEach(() => {
  cleanup();
  vi.useFakeTimers();
  useWeatherStore.setState({ stations: [], currentReadings: new Map() });
});
afterEach(() => vi.useRealTimers());

describe('when it leaves', () => {
  it('stays while nothing has happened and the limit has not passed', () => {
    const { container } = render(<LoadingScreen error={null} onDone={() => {}} />);
    act(() => { vi.advanceTimersByTime(MAX_WAIT_MS - 100); });
    expect(screenOf(container).hasAttribute('data-leaving')).toBe(false);
  });

  it('goes with the first readings', () => {
    const { container } = render(<LoadingScreen error={null} onDone={() => {}} />);
    act(() => { useWeatherStore.setState({ currentReadings: new Map([['a', {} as NormalizedReading]]) }); });
    expect(screenOf(container).hasAttribute('data-leaving')).toBe(true);
  });

  it('goes with an error: the map says the rest', () => {
    const { container } = render(<LoadingScreen error="sin red" onDone={() => {}} />);
    expect(screenOf(container).hasAttribute('data-leaving')).toBe(true);
  });

  it('goes at the limit even if nothing has arrived, and never stays on', () => {
    const onDone = vi.fn();
    const { container } = render(<LoadingScreen error={null} onDone={onDone} />);
    act(() => { vi.advanceTimersByTime(MAX_WAIT_MS); });
    expect(screenOf(container).hasAttribute('data-leaving')).toBe(true);
    // No end of the transition (a hidden tab): it is done anyway
    act(() => { vi.advanceTimersByTime(500); });
    expect(onDone).toHaveBeenCalled();
  });

  it('is done when its own fade ends, not when the bar stops', () => {
    const onDone = vi.fn();
    const { container } = render(<LoadingScreen error="x" onDone={onDone} />);
    const bar = container.querySelector('.gc-boot-bar i') as HTMLElement;
    fireEvent.transitionEnd(bar, { propertyName: 'transform' });
    expect(onDone).not.toHaveBeenCalled();
    const end = new Event('transitionend', { bubbles: true });
    Object.defineProperty(end, 'propertyName', { value: 'opacity' });
    act(() => { screenOf(container).dispatchEvent(end); });
    expect(onDone).toHaveBeenCalled();
  });
});

describe('what it says', () => {
  it('names the stations once it knows them', () => {
    const { container } = render(<LoadingScreen error={null} onDone={() => {}} />);
    expect(container.textContent).toContain('Cargando');
    act(() => { useWeatherStore.setState({ stations: [{} as NormalizedStation, {} as NormalizedStation] }); });
    expect(container.textContent).toContain('Leyendo 2 estaciones');
  });
});

describe('the bar', () => {
  it('goes forward with what happens and is full with readings', () => {
    expect(loadProgress(0, 0, 0)).toBeLessThan(loadProgress(0, 10, 0));
    expect(loadProgress(0, 10, 0)).toBeLessThan(loadProgress(0, 10, 5));
    expect(loadProgress(0, 10, 5)).toBe(1);
  });

  it('never goes back from where the page left it', () => {
    expect(loadProgress(0.5, 0, 0)).toBe(0.5);
    expect(loadProgress(0.9, 10, 0)).toBe(0.9);
  });
});
