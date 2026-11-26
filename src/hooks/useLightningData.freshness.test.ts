/**
 * When our lightning API fails, the map must not read «no strikes» as «no storm». Since 9-oct the
 * browser no longer falls back to meteo2api, so this is the only guard: the last good picture
 * stays as it was, the error is set (the chip shows its age and the hook retries), and with
 * no answer at all since the page opened the chip says «sin dato», not nothing.
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
import { LightningDataChip } from '../components/map/LightningDataChip';
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

  it('our API answers but MeteoGalicia stopped: last picture kept, error with the time, lastFetch at its last good answer', async () => {
    fetchMock.mockResolvedValueOnce({ strikes: [strike(3)], asOf: T, fresh: true });
    renderHook(() => useLightningData());
    await act(async () => { await poll!(); });

    vi.setSystemTime(T + 20 * 60_000);
    fetchMock.mockResolvedValue({ strikes: [], asOf: T + 20 * 60_000, fresh: false, feedStale: { lastOkAt: T - 60_000 } });
    await act(async () => { await poll!(); });
    const s = useLightningStore.getState();
    expect(s.strikes).toHaveLength(1);
    expect(s.error).toBe('MeteoGalicia no da rayos desde las 14:59'); // T - 1 min = 12:59Z = 14:59 in Madrid (summer time)
    expect(s.lastFetch?.getTime()).toBe(T - 60_000);
    render(createElement(LightningDataChip));
    expect(screen.getByText('Rayos: dato de hace 21 min')).toBeTruthy();
  });

  it('MeteoGalicia never answered the ingestor: «sin dato»', async () => {
    fetchMock.mockResolvedValue({ strikes: [], asOf: T, fresh: false, feedStale: { lastOkAt: null } });
    renderHook(() => useLightningData());
    await act(async () => { await poll!(); });
    const s = useLightningStore.getState();
    expect(s.lastFetch).toBeNull();
    expect(s.error).toBe('MeteoGalicia no da rayos');
    render(createElement(LightningDataChip));
    expect(screen.getByText('Rayos: sin dato')).toBeTruthy();
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

describe('The map says when there is no lightning data', () => {
  it('«sin dato» when the server never answered', () => {
    useLightningStore.setState({ lastFetch: null, error: 'Sin datos de rayos: el servidor no responde' });
    render(createElement(LightningDataChip));
    expect(screen.getByText('Rayos: sin dato')).toBeTruthy();
  });

  it('the age of the data when the last good answer is old', () => {
    useLightningStore.setState({ lastFetch: new Date(T - 9 * 60_000), error: 'Sin respuesta del servidor de rayos' });
    render(createElement(LightningDataChip));
    expect(screen.getByText('Rayos: dato de hace 9 min')).toBeTruthy();
    expect(screen.queryByText('Rayos: sin dato')).toBeNull();
  });

  it('nothing when the data is fresh: quiet is the normal state', () => {
    useLightningStore.setState({ lastFetch: new Date(T - 2 * 60_000), error: null });
    const { container } = render(createElement(LightningDataChip));
    expect(container.textContent).toBe('');
  });
});
