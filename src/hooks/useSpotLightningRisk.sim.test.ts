/**
 * The demo storm (`?simstrike=<spot>`) names the spot it was asked about. Its strikes fall north of that spot and may be
 * as close to a neighbour: `?simstrike=cesantes` read «RAYO A 6 KM — LOURIDO» (25-nov).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSpotLightningRisk } from './useSpotLightningRisk';
import { useSectorStore } from '../store/sectorStore';
import { SECTORS } from '../config/sectors';

const at = (search: string) => window.history.replaceState(null, '', `/${search}`);

beforeEach(() => useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! } as never));
afterEach(() => at(''));

describe('the demo storm', () => {
  it('puts the spot asked for first, with its neighbours after it', () => {
    at('?simstrike=cesantes');
    const { result } = renderHook(() => useSpotLightningRisk());
    expect(result.current[0].spotId).toBe('cesantes');
    expect(result.current[0].level).toBe('peligro');
    expect(result.current.length).toBeGreaterThan(1);
    expect(result.current.filter((r) => r.spotId === 'cesantes')).toHaveLength(1);
  });

  it('is not there without the parameter', () => {
    const { result } = renderHook(() => useSpotLightningRisk());
    expect(result.current).toEqual([]);
  });
});
