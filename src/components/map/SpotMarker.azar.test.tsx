/**
 * Two lines of the spot marker that the random breaks of 11-nov went through with the whole suite green: the flash
 * when a surf spot becomes surfable, and a wind spot without a verdict yet. Each test was checked to fail with its
 * one-token break.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen } from '@testing-library/react';

vi.mock('react-map-gl/maplibre', async () => {
  const React = await import('react');
  const { createPortal } = await import('react-dom');
  const Marker = React.forwardRef<unknown, { children?: React.ReactNode }>(function Marker({ children }, ref) {
    const el = React.useMemo(() => document.createElement('div'), []);
    React.useImperativeHandle(ref, () => ({ getElement: () => el }), [el]);
    React.useEffect(() => {
      document.body.appendChild(el);
      return () => { el.remove(); };
    }, [el]);
    return createPortal(children, el);
  });
  return { Marker, useMap: () => ({ current: null }) };
});

vi.mock('../../hooks/useMapInk', () => ({ useMapInk: () => ({ text: '#fff', halo: '#000', shadow: 'none' }) }));

import { SpotMarkers } from './SpotMarker';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { SECTORS } from '../../config/sectors';
import { ALL_SPOTS } from '../../config/spots';
import { buildSurfEntry } from '../../services/surfVerdictEngine';
import type { MarineForecastHour } from '../../api/marineClient';
import type { SpotScore } from '../../services/spotScoringEngine';

const HOUR = 3_600_000;
const CORRUBEDO = ALL_SPOTS.find((s) => s.id === 'surf-corrubedo')!;
const VAO = ALL_SPOTS.find((s) => s.id === 'vao')!;

function score(spotId: string, over: Record<string, unknown> = {}): SpotScore {
  return {
    spotId, spotName: spotId, verdict: 'sailing', score: 50, summary: '',
    wind: { stationCount: 3, avgSpeedKt: 10, rawAvgSpeedKt: 10, dominantDir: 'NE', dirDeg: 45 },
    waves: null, effectiveWindKt: 10, windDirDeg: 45, provisional: false, hardGateTriggered: null, thermal: null,
    computedAt: new Date(), ...over,
  } as unknown as SpotScore;
}

/** NW swell of the given height, 9 s, around now */
function swell(heightM: number): MarineForecastHour[] {
  const start = Math.floor(Date.now() / HOUR) * HOUR - HOUR;
  return Array.from({ length: 30 }, (_, i) => ({
    time: new Date(start + i * HOUR), waveHeight: heightM, wavePeriod: 9, waveDirection: 315,
    swellHeight: heightM, swellPeriod: 9, swellDirection: 315,
  }));
}

function surfEntry(s: SpotScore, heightM: number) {
  return buildSurfEntry(CORRUBEDO, swell(heightM), s, Date.now(), Date.now(), false);
}

function seed(s: SpotScore, entry?: ReturnType<typeof buildSurfEntry>) {
  useSpotStore.setState({
    scores: new Map([[s.spotId, s]]), lastScored: Date.now(), windHistory: new Map(),
    surfWaveCache: entry ? new Map([[s.spotId, entry]]) : new Map(),
  } as never);
}

const marker = (shortName: string) => screen.getByRole('button', { name: new RegExp(`^Spot ${shortName}`) });
const flashing = (shortName: string) => marker(shortName).querySelector('.animate-verdict-pop') !== null;

beforeEach(() => {
  useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! } as never);
  useSpotStore.getState().selectSpot('');
});

afterEach(() => {
  cleanup();
  useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), windHistory: new Map(), lastScored: 0 } as never);
});

describe('the flash of a surf spot that becomes surfable', () => {
  const calm = () => score(CORRUBEDO.id, { verdict: 'calm', effectiveWindKt: 4, windDirDeg: 315 });

  it('from small waves to SURF OK: it flashes', () => {
    const s = calm();
    const small = surfEntry(s, 0.6);
    const good = surfEntry(s, 1.3);
    expect(small.verdict!.level).toBeLessThan(2);
    expect(good.verdict!.level).toBe(2);

    seed(s, small);
    render(<SpotMarkers />);
    expect(flashing(CORRUBEDO.shortName)).toBe(false);

    act(() => seed(s, good));
    expect(flashing(CORRUBEDO.shortName)).toBe(true);
  });

  it('staying small does not', () => {
    const s = calm();
    seed(s, surfEntry(s, 0.4));
    render(<SpotMarkers />);
    act(() => seed(s, surfEntry(s, 0.6)));
    expect(flashing(CORRUBEDO.shortName)).toBe(false);
  });
});

describe('a wind spot with no verdict yet', () => {
  it('says nothing of its own: no «Sin datos», no figure', () => {
    seed(score(VAO.id, { verdict: 'unknown' }));
    render(<SpotMarkers />);
    const label = marker(VAO.shortName).getAttribute('aria-label')!;
    expect(label).not.toContain('Sin datos');
    expect(label).not.toMatch(/\d+ kt/);
  });

  it('a verdict with no wind figure behind it shows no «0 kt»', () => {
    seed(score(VAO.id, {
      verdict: 'calm', effectiveWindKt: null,
      wind: { stationCount: 0, avgSpeedKt: null, rawAvgSpeedKt: null, dominantDir: null, dirDeg: null },
    }));
    render(<SpotMarkers />);
    const label = marker(VAO.shortName).getAttribute('aria-label')!;
    expect(label).not.toMatch(/\bkt\b/);
    expect(marker(VAO.shortName).textContent).not.toMatch(/(^|\D)0(\D|$)/);
  });

  it('and with a verdict it says it', () => {
    seed(score(VAO.id));
    render(<SpotMarkers />);
    expect(marker(VAO.shortName).getAttribute('aria-label')).toMatch(/10 kt del NE/);
  });
});
