/**
 * The Spots list marks the chosen spot and only that one. The random break of 11-nov that marked every row but the
 * chosen one went through the whole suite green; this test was checked to fail with it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import { SpotSelector } from './SpotSelector';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { SECTORS } from '../../config/sectors';
import { getSpotsForSector } from '../../config/spots';

const rias = getSpotsForSector('rias');

beforeEach(() => {
  useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! } as never);
  useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), windHistory: new Map() } as never);
});

afterEach(() => {
  cleanup();
  useSpotStore.getState().selectSpot('');
});

describe('the chosen spot in the list', () => {
  it('only its row is marked as the current one', () => {
    const chosen = rias[2];
    useSpotStore.getState().selectSpot(chosen.id);
    render(<SpotSelector />);

    const rows = [...document.querySelectorAll<HTMLElement>('.gc-listrow')];
    expect(rows).toHaveLength(rias.length);
    const current = rows.filter((r) => r.hasAttribute('data-current'));
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('data-flip-key')).toBe(chosen.id);
    expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
  });

  it('with none chosen, no row is marked', () => {
    render(<SpotSelector />);
    expect(document.querySelectorAll('.gc-listrow[data-current]')).toHaveLength(0);
  });
});
