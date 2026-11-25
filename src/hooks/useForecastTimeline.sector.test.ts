import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useForecastTimeline, useForecastStore } from './useForecastTimeline';
import { useSectorStore } from '../store/sectorStore';
import type { HourlyForecast } from '../types/forecast';

afterEach(() => { vi.unstubAllGlobals(); });

describe('changing sector (review, 18-nov)', () => {
  it('drops the convection of the old sector too, not only its hours', () => {
    // Requests never answer: what is on screen is only what the change of sector left
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    useSectorStore.getState().switchSector('rias');
    const storm = [{ time: new Date(), cape: 900, liftedIndex: -3 } as unknown as HourlyForecast];
    useForecastStore.setState({ hourly: storm, convectionData: storm });
    renderHook(() => useForecastTimeline());
    act(() => { useSectorStore.getState().switchSector('embalse'); });
    expect(useForecastStore.getState().hourly).toEqual([]);
    expect(useForecastStore.getState().convectionData).toEqual([]);
  });
});
