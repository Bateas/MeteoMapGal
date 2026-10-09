/**
 * The Embalse thermal context (ΔT of Ourense, atmosphere, tendencies) describes the reservoir
 * valley and must not survive a switch to the Rías. Kept, it fed the Rías spots: the card read
 * «Térmica 41 % prob» in Cesantes and centro-ría (9-oct), the engine could boost the wind of
 * the thermal spots, and the forecast panel showed the Embalse «ΔT hoy». These tests pin the
 * three ways in: what was already in the store, an answer that lands after the switch, and
 * the atmosphere coming back when the user returns to the Embalse.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('../api/openMeteoClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/openMeteoClient')>()),
  fetchForecastForZones: vi.fn(() => new Promise(() => {})),
  fetchDailyContextForEmbalse: vi.fn(),
  fetchAtmosphericContextForEmbalse: vi.fn(),
  fetchOpenMeteoHistory: vi.fn(async () => []),
}));

import { useThermalAnalysis } from './useThermalAnalysis';
import { useThermalStore } from '../store/thermalStore';
import { useSectorStore } from '../store/sectorStore';
import { SECTORS } from '../config/sectors';
import { fetchDailyContextForEmbalse, fetchAtmosphericContextForEmbalse } from '../api/openMeteoClient';
import type { AtmosphericContext, DailyContext, MicroZoneId, TendencySignal } from '../types/thermal';

const DAILY: DailyContext = { tempMax: 30, tempMin: 12, deltaT: 18 };
const ATMOS: AtmosphericContext = {
  cloudCover: 10, solarRadiation: 700, cape: 300, boundaryLayerHeight: 1600,
  liftedIndex: -2, convectiveInhibition: 20, fetchedAt: new Date(),
};

function setSector(id: 'rias' | 'embalse') {
  useSectorStore.setState({ activeSectorId: id, activeSector: SECTORS.find((s) => s.id === id)! });
}

/** What an earlier visit to the Embalse leaves in the store. */
function seedEmbalseContext() {
  useThermalStore.setState({
    dailyContext: DAILY,
    atmosphericContext: ATMOS,
    tendencySignals: new Map([['embalse' as MicroZoneId, { zoneId: 'embalse', score: 70, level: 'likely' } as unknown as TendencySignal]]),
  });
}

const daily = vi.mocked(fetchDailyContextForEmbalse);
const atmos = vi.mocked(fetchAtmosphericContextForEmbalse);

beforeEach(() => {
  daily.mockReset();
  atmos.mockReset();
  daily.mockResolvedValue(DAILY);
  atmos.mockResolvedValue(ATMOS);
  useThermalStore.setState({ dailyContext: null, atmosphericContext: null, tendencySignals: new Map() });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useThermalAnalysis keeps the Embalse context in the Embalse', () => {
  it('in the Rías, what an earlier Embalse visit left is cleared', () => {
    seedEmbalseContext();
    setSector('rias');
    renderHook(() => useThermalAnalysis());
    const s = useThermalStore.getState();
    expect(s.dailyContext).toBeNull();
    expect(s.atmosphericContext).toBeNull();
    expect(s.tendencySignals.size).toBe(0);
    expect(daily).not.toHaveBeenCalled();
  });

  it('inside the Embalse the daily context is kept (control)', async () => {
    setSector('embalse');
    renderHook(() => useThermalAnalysis());
    await waitFor(() => expect(useThermalStore.getState().dailyContext?.deltaT).toBe(18));
  });

  it('an Embalse answer landing after the switch to the Rías is dropped', async () => {
    let resolve!: (ctx: DailyContext) => void;
    daily.mockImplementation(() => new Promise<DailyContext>((r) => { resolve = r; }));
    setSector('embalse');
    const { rerender } = renderHook(() => useThermalAnalysis());
    expect(daily).toHaveBeenCalledTimes(1);
    act(() => setSector('rias'));
    rerender();
    await act(async () => { resolve(DAILY); await Promise.resolve(); });
    expect(useThermalStore.getState().dailyContext).toBeNull();
  });

  it('coming back to the Embalse asks for the atmosphere again, without waiting 15 minutes', async () => {
    vi.useFakeTimers();
    setSector('embalse');
    const { rerender } = renderHook(() => useThermalAnalysis());
    await act(async () => { vi.advanceTimersByTime(8_000); });
    expect(atmos).toHaveBeenCalledTimes(1);

    act(() => setSector('rias'));
    rerender();
    await act(async () => { vi.advanceTimersByTime(20 * 60_000); });
    expect(atmos).toHaveBeenCalledTimes(1); // no polling outside the Embalse
    expect(useThermalStore.getState().atmosphericContext).toBeNull();

    act(() => setSector('embalse'));
    rerender();
    await act(async () => { vi.advanceTimersByTime(8_000); });
    expect(atmos).toHaveBeenCalledTimes(2);
  });
});
