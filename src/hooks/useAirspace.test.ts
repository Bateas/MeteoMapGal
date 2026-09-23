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
});
