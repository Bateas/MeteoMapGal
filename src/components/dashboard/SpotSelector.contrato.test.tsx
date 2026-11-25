/**
 * Contract tests for the Spots list (17-nov, zone 3 of the plan): which row is the favourite, and the wave a surf beach
 * names only when its verdict is ready. They cover breaks the full sweep of 12-nov left alive in SpotSelector.tsx.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

import { SpotSelector } from './SpotSelector';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { SECTORS } from '../../config/sectors';
import { ALL_SPOTS } from '../../config/spots';
import { buildSurfEntry } from '../../services/surfVerdictEngine';
import type { MarineForecastHour } from '../../api/marineClient';
import type { SpotScore } from '../../services/spotScoringEngine';

const HOUR = 3_600_000;
const BEACH = ALL_SPOTS.find((s) => s.id === 'surf-corrubedo')!;
const VAO = ALL_SPOTS.find((s) => s.id === 'vao')!;
const rowOf = (id: string) => document.querySelector<HTMLElement>(`.gc-listrow[data-flip-key="${id}"]`)!;

function score(spotId: string): SpotScore {
  return {
    spotId, spotName: spotId, verdict: 'calm', score: 20, summary: '',
    wind: { stationCount: 3, avgSpeedKt: 4, rawAvgSpeedKt: 4, dominantDir: 'NW', dirDeg: 315 },
    waves: null, effectiveWindKt: 4, windDirDeg: 315, provisional: false, hardGateTriggered: null, thermal: null,
    computedAt: new Date(),
  } as unknown as SpotScore;
}

function swell(m: number): MarineForecastHour[] {
  const start = Math.floor(Date.now() / HOUR) * HOUR - HOUR;
  return Array.from({ length: 30 }, (_, i) => ({
    time: new Date(start + i * HOUR), waveHeight: m, wavePeriod: 9, waveDirection: 315, swellHeight: m, swellPeriod: 9, swellDirection: 315,
  }));
}

beforeEach(() => {
  useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! } as never);
});

afterEach(() => {
  cleanup();
  useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), windHistory: new Map(), favoriteSpotId: null } as never);
});

describe('the favourite', () => {
  it('only its own row says it is the favourite', () => {
    useSpotStore.setState({ scores: new Map([[VAO.id, score(VAO.id)]]), favoriteSpotId: VAO.id } as never);
    render(<SpotSelector />);
    expect(screen.getByRole('button', { name: `Quitar de favorito: ${VAO.shortName}` })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Quitar de favorito/ })).toHaveLength(1);
  });
});

describe('the wave of a surf beach in the list', () => {
  it('is named once its verdict is ready', () => {
    const s = score(BEACH.id);
    const entry = buildSurfEntry(BEACH, swell(1.3), s, Date.now(), Date.now(), false);
    useSpotStore.setState({ scores: new Map([[s.spotId, s]]), surfWaveCache: new Map([[s.spotId, entry]]) } as never);
    render(<SpotSelector />);
    expect(rowOf(BEACH.id).textContent).toContain('~1,1 m');
  });

  it('is not named, nor any wind, while the beach is waiting', () => {
    const s = score(BEACH.id);
    useSpotStore.setState({ scores: new Map([[s.spotId, s]]), surfWaveCache: new Map() } as never);
    render(<SpotSelector />);
    expect(rowOf(BEACH.id).textContent).not.toMatch(/ m\b|kt/);
  });
});

describe('a beach whose wave arrived before its wind', () => {
  it('does not name the wave while it is still calculating', () => {
    const s = { ...score(BEACH.id), provisional: true } as SpotScore;
    const entry = buildSurfEntry(BEACH, swell(1.3), s, Date.now(), Date.now(), false);
    useSpotStore.setState({ scores: new Map([[s.spotId, s]]), surfWaveCache: new Map([[s.spotId, entry]]) } as never);
    render(<SpotSelector />);
    expect(rowOf(BEACH.id).textContent).not.toContain('~1,1 m');
  });
});
