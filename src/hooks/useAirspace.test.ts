/**
 * ENAIRE is only shown in alphaMode (drone tab, airspace overlay, drone
 * alert), so it must only be fetched in alphaMode. It used to be fetched for
 * every visitor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../api/enaireClient', () => ({
  fetchUasZones: vi.fn(async () => []),
  fetchActiveNotams: vi.fn(async () => []),
  bboxFromCenter: () => ({ minLat: 0, minLon: 0, maxLat: 1, maxLon: 1 }),
}));

import { fetchUasZones, fetchActiveNotams } from '../api/enaireClient';
import { useAirspace } from './useAirspace';
import { useUIStore } from '../store/uiStore';
import { useAirspaceStore } from '../store/airspaceStore';

describe('useAirspace', () => {
  beforeEach(() => {
    vi.mocked(fetchUasZones).mockClear();
    vi.mocked(fetchActiveNotams).mockClear();
    useAirspaceStore.getState().reset();
    useUIStore.setState({ alphaMode: false });
  });

  it('does not ask ENAIRE while alphaMode is off', async () => {
    renderHook(() => useAirspace());
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchUasZones).not.toHaveBeenCalled();
    expect(fetchActiveNotams).not.toHaveBeenCalled();
  });

  it('asks as soon as alphaMode is turned on', async () => {
    renderHook(() => useAirspace());
    act(() => useUIStore.setState({ alphaMode: true }));
    await waitFor(() => expect(fetchUasZones).toHaveBeenCalled());
    expect(fetchActiveNotams).toHaveBeenCalled();
  });

  it('marks the part ENAIRE did not give, and keeps the part it gave', async () => {
    vi.mocked(fetchUasZones).mockRejectedValueOnce(new Error('ENAIRE no responde (zonas UAS)'));
    useUIStore.setState({ alphaMode: true });
    renderHook(() => useAirspace());
    await waitFor(() => expect(useAirspaceStore.getState().missing).toEqual({ zones: true, notams: false }));
    const st = useAirspaceStore.getState();
    expect(st.check).not.toBeNull();
    expect(st.lastZoneFetch).toBe(0); // a failed part is asked again on the next poll
    expect(st.lastNotamFetch).toBeGreaterThan(0);
    // ...on the next poll, not at once: its own results must not run it again (that looped).
    await new Promise((r) => setTimeout(r, 100));
    expect(fetchUasZones).toHaveBeenCalledTimes(1);
  });

  it('nothing is missing when ENAIRE gives both parts', async () => {
    useUIStore.setState({ alphaMode: true });
    renderHook(() => useAirspace());
    await waitFor(() => expect(useAirspaceStore.getState().check).not.toBeNull());
    expect(useAirspaceStore.getState().missing).toEqual({ zones: false, notams: false });
  });
});
