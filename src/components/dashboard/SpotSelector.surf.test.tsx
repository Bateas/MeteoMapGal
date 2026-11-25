/**
 * Random break of 12-nov that went through with the whole suite green: the hexagon of a surf beach in the Spots list
 * lost its surf colour and turned grey once its verdict was ready; a wind spot waiting for its verdict, and one closed by
 * the sea, in the same list. Checked to fail with that break.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import { SpotSelector } from './SpotSelector';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { SECTORS } from '../../config/sectors';
import { ALL_SPOTS } from '../../config/spots';
import { VERDICT_LINE, surfTone } from '../../config/verdictStyles';
import { buildSurfEntry } from '../../services/surfVerdictEngine';
import type { MarineForecastHour } from '../../api/marineClient';
import type { SpotScore } from '../../services/spotScoringEngine';

const HOUR = 3_600_000;
const BEACH = ALL_SPOTS.find((s) => s.id === 'surf-corrubedo')!;
const VAO = ALL_SPOTS.find((s) => s.id === 'vao')!;
const rowOf = (id: string) => document.querySelector<HTMLElement>(`.gc-listrow[data-flip-key="${id}"]`)!;

function calm(): SpotScore {
  return {
    spotId: BEACH.id, spotName: BEACH.id, verdict: 'calm', score: 20, summary: '',
    wind: { stationCount: 3, avgSpeedKt: 4, rawAvgSpeedKt: 4, dominantDir: 'NW', dirDeg: 315 },
    waves: null, effectiveWindKt: 4, windDirDeg: 315, provisional: false, hardGateTriggered: null, thermal: null,
    computedAt: new Date(),
  } as unknown as SpotScore;
}

function swell(m: number): MarineForecastHour[] {
  const start = Math.floor(Date.now() / HOUR) * HOUR - HOUR;
  return Array.from({ length: 30 }, (_, i) => ({
    time: new Date(start + i * HOUR), waveHeight: m, wavePeriod: 9, waveDirection: 315,
    swellHeight: m, swellPeriod: 9, swellDirection: 315,
  }));
}

beforeEach(() => {
  useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! } as never);
});

afterEach(() => {
  cleanup();
  useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), windHistory: new Map() } as never);
});

describe('a surf beach in the Spots list', () => {
  it('with its verdict ready, its shape wears the surf colour', () => {
    const s = calm();
    const entry = buildSurfEntry(BEACH, swell(1.3), s, Date.now(), Date.now(), false);
    expect(entry.verdict).toBeTruthy();
    useSpotStore.setState({ scores: new Map([[s.spotId, s]]), surfWaveCache: new Map([[s.spotId, entry]]), windHistory: new Map() } as never);
    render(<SpotSelector />);
    const row = document.querySelector<HTMLElement>(`.gc-listrow[data-flip-key="${BEACH.id}"]`)!;
    expect(row.querySelector('polygon')!.getAttribute('fill')).toBe(VERDICT_LINE[surfTone(entry.verdict!.level)]);
  });
});

describe('a surf beach with no wave hour near now', () => {
  it('is grey: no colour from the wind verdict stands in for the waves', () => {
    const s = { ...calm(), verdict: 'good' } as SpotScore;
    const old = swell(1.3).map((h) => ({ ...h, time: new Date(h.time.getTime() - 3 * 86_400_000) }));
    const entry = buildSurfEntry(BEACH, old, s, Date.now(), Date.now(), false);
    useSpotStore.setState({ scores: new Map([[s.spotId, s]]), surfWaveCache: new Map([[s.spotId, entry]]), windHistory: new Map() } as never);
    render(<SpotSelector />);
    expect(rowOf(BEACH.id).querySelector('polygon')!.getAttribute('fill')).toBe('var(--g-hair)');
  });
});

describe('a wind spot in the Spots list', () => {
  it('still being worked out, its shape is the plain grey of waiting', () => {
    useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), windHistory: new Map() } as never);
    render(<SpotSelector />);
    expect(rowOf(VAO.id).querySelector('polygon')!.getAttribute('fill')).toBe('var(--g-hair)');
  });

  it('closed by the sea, its figure is the sea and no wind direction goes beside it', () => {
    const s = {
      spotId: VAO.id, spotName: VAO.id, verdict: 'dangerous', score: 0, summary: '',
      wind: { stationCount: 3, avgSpeedKt: 12, rawAvgSpeedKt: 12, dominantDir: 'SO', dirDeg: 225 },
      waves: { waveHeight: 3.4, localHeight: 3.4, localSource: 'buoy' }, effectiveWindKt: 12, windDirDeg: 225,
      provisional: false, hardGateTriggered: 'Oleaje', hardGateKind: 'wave', thermal: null, computedAt: new Date(),
    } as unknown as SpotScore;
    useSpotStore.setState({ scores: new Map([[s.spotId, s]]), surfWaveCache: new Map(), windHistory: new Map() } as never);
    render(<SpotSelector />);
    const fig = rowOf(VAO.id).querySelector('.gc-rowfig')!;
    expect(fig.textContent).toContain('3,4 m');
    expect(fig.textContent).not.toContain('SO');
  });
});

