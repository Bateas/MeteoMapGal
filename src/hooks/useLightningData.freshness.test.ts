/**
 * When our lightning API fails, the map must not read «no strikes» as «no storm». Since 9-oct the
 * browser no longer falls back to meteo2api, so this is the only guard: the last good picture
 * stays as it was, the error is set (the indicator shows its age and the hook retries), and with
 * no answer at all since the page opened the indicator says «sin dato», not «sin actividad».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, screen, act } from '@testing-library/react';
import { createElement } from 'react';

let poll: (() => void | Promise<void>) | null = null;
vi.mock('./useVisibilityPolling', () => ({
  useVisibilityPolling: (cb: () => void | Promise<void>) => { poll = cb; },
}));
vi.mock('../api/lightningClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/lightningClient')>()),
  fetchLightningStrikes: vi.fn(),
}));

import { useLightningData, useLightningStore } from './useLightningData';
import { fetchLightningStrikes } from '../api/lightningClient';
import { StormIndicator } from '../components/map/StormIndicator';
import type { LightningStrike } from '../types/lightning';

const fetchMock = vi.mocked(fetchLightningStrikes);
const T = Date.parse('2026-10-09T13:00:00Z');

function strike(ageMin: number): LightningStrike {
  return { id: 1, lat: 42.3, lon: -8.7, timestamp: T - ageMin * 60_000, peakCurrent: -20,
    cloudToCloud: false, multiplicity: 1, ageMinutes: ageMin };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
  vi.setSystemTime(T);
  fetchMock.mockReset();
  poll = null;
  useLightningStore.setState({ strikes: [], lastFetch: null, error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useLightningData when our API fails', () => {
  it('keeps the last picture, sets the error and leaves lastFetch at the last good answer', async () => {
    fetchMock.mockResolvedValueOnce({ strikes: [strike(3)], asOf: T, fresh: true });
    renderHook(() => useLightningData());
    await act(async () => { await poll!(); });
    expect(useLightningStore.getState().strikes).toHaveLength(1);
    expect(useLightningStore.getState().error).toBeNull();
    expect(useLightningStore.getState().lastFetch?.getTime()).toBe(T);

    vi.setSystemTime(T + 8 * 60_000);
    fetchMock.mockResolvedValue({ strikes: [], asOf: T, fresh: false });
    await act(async () => { await poll!(); });
    const s = useLightningStore.getState();
    expect(s.strikes).toHaveLength(1); // not wiped: a storm that stops being read has not gone away
    expect(s.error).toMatch(/servidor de rayos/);
    expect(s.lastFetch?.getTime()).toBe(T); // the indicator shows 8 min, not «just now»
  });

  it('cold start with our API down: no lastFetch, error set', async () => {
    fetchMock.mockResolvedValue({ strikes: [], asOf: null, fresh: false });
    renderHook(() => useLightningData());
    await act(async () => { await poll!(); });
    const s = useLightningStore.getState();
    expect(s.lastFetch).toBeNull();
    expect(s.error).toMatch(/Sin datos de rayos/);
  });
});

describe('StormIndicator says when there is no lightning data', () => {
  it('«sin dato» when the server never answered', () => {
    useLightningStore.setState({ lastFetch: null, error: 'Sin datos de rayos: el servidor no responde' });
    render(createElement(StormIndicator));
    expect(screen.getByText('sin dato')).toBeTruthy();
  });

  it('the age of the data when the last good answer is old', () => {
    useLightningStore.setState({ lastFetch: new Date(T - 9 * 60_000), error: 'Sin respuesta del servidor de rayos' });
    render(createElement(StormIndicator));
    expect(screen.getByText('9m')).toBeTruthy();
    expect(screen.queryByText('sin dato')).toBeNull();
  });
});
