import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDeepLink } from './useDeepLink';
import { useUIStore } from '../store/uiStore';
import { useSpotStore } from '../store/spotStore';
import { useSectorStore } from '../store/sectorStore';

const go = (path: string) => window.history.replaceState({}, '', path);

beforeEach(() => {
  vi.useFakeTimers();
  useUIStore.setState({ onboardingCompleted: true, onboardingStep: null, guideOpen: false });
  useSpotStore.setState({ favoriteSpotId: 'cesantes', activeSpotId: '' });
  useSectorStore.getState().switchSector('rias');
});
afterEach(() => { vi.useRealTimers(); go('/'); });

describe('useDeepLink (18-nov)', () => {
  it('?bienvenida asks the welcome questions again, cleans the address and opens no favourite under them', () => {
    go('/?bienvenida');
    renderHook(() => useDeepLink());
    vi.runAllTimers();
    expect(useUIStore.getState().onboardingCompleted).toBe(false);
    expect(window.location.search).toBe('');
    expect(useSpotStore.getState().activeSpotId).toBe('');
  });

  it('with no link, the favourite spot opens in its own zone', () => {
    useSectorStore.getState().switchSector('embalse');
    go('/');
    renderHook(() => useDeepLink());
    vi.runAllTimers();
    expect(useSectorStore.getState().activeSector.id).toBe('rias');
    expect(useSpotStore.getState().activeSpotId).toBe('cesantes');
  });

  it('a shared spot wins over the favourite', () => {
    go('/?sector=rias&spot=vao');
    renderHook(() => useDeepLink());
    vi.runAllTimers();
    expect(useSpotStore.getState().activeSpotId).toBe('vao');
  });
});
