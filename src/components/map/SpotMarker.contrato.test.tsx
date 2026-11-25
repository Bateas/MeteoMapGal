/**
 * Contract tests for what a spot marker says to whoever cannot see it (its name for a screen reader), in tables
 * (17-nov, zone 3 of the plan): the state, the knots and where they come from; the wave of a surf beach, with or
 * without a height worth naming. They cover breaks the full sweep of 12-nov left alive in SpotMarker.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

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

import { SpotMarkers } from './SpotMarker';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { SECTORS } from '../../config/sectors';
import { ALL_SPOTS } from '../../config/spots';
import { buildSurfEntry } from '../../services/surfVerdictEngine';
import type { MarineForecastHour } from '../../api/marineClient';
import type { SpotScore } from '../../services/spotScoringEngine';

const HOUR = 3_600_000;
const VAO = ALL_SPOTS.find((s) => s.id === 'vao')!;
const CORRUBEDO = ALL_SPOTS.find((s) => s.id === 'surf-corrubedo')!;

function score(spotId: string, over: Record<string, unknown> = {}): SpotScore {
  return {
    spotId, spotName: spotId, verdict: 'sailing', score: 50, summary: '',
    wind: { stationCount: 3, avgSpeedKt: 10, rawAvgSpeedKt: 10, dominantDir: 'NE', dirDeg: 45 },
    waves: null, effectiveWindKt: 10, windDirDeg: 45, provisional: false, hardGateTriggered: null, thermal: null,
    computedAt: new Date(), ...over,
  } as unknown as SpotScore;
}

/** The same swell all day, of this height. */
function swell(m: number): MarineForecastHour[] {
  const start = Math.floor(Date.now() / HOUR) * HOUR - HOUR;
  return Array.from({ length: 30 }, (_, i) => ({
    time: new Date(start + i * HOUR), waveHeight: m, wavePeriod: 9, waveDirection: 315,
    swellHeight: m, swellPeriod: 9, swellDirection: 315,
  }));
}

function seed(s: SpotScore, surfEntry?: ReturnType<typeof buildSurfEntry>) {
  useSpotStore.setState({
    scores: new Map([[s.spotId, s]]), lastScored: Date.now(),
    surfWaveCache: surfEntry ? new Map([[s.spotId, surfEntry]]) : new Map(),
  } as never);
}

const name = (shortName: string) => screen.getByRole('button', { name: new RegExp(`^Spot ${shortName}`) }).getAttribute('aria-label');

beforeEach(() => {
  useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! } as never);
  useSpotStore.getState().selectSpot('');
});

afterEach(() => {
  cleanup();
  useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), lastScored: 0 } as never);
});

describe('a wind spot', () => {
  it.each([
    ['state, knots and heading', {}, 'Spot Vao: Navegable 10 kt del NE'],
    ['no heading when the sources disagree', { windDirDeg: null, wind: { stationCount: 3, avgSpeedKt: 10, rawAvgSpeedKt: 10, dominantDir: null, dirDeg: null } }, 'Spot Vao: Navegable 10 kt'],
    ['still calculating', { provisional: true }, 'Spot Vao: calculando condiciones'],
  ] as const)('%s', (_, over, words) => {
    seed(score(VAO.id, over));
    render(<SpotMarkers />);
    expect(name('Vao')).toBe(words);
  });
});

describe('a surf beach', () => {
  const surf = (m: number) => {
    const s = score(CORRUBEDO.id);
    seed(s, buildSurfEntry(CORRUBEDO as never, swell(m), s, Date.now(), Date.now(), false));
    render(<SpotMarkers />);
    return name('Corrubedo') ?? '';
  };

  it('names the wave when there is one worth naming, and says it is a model', () => {
    expect(surf(1.3)).toMatch(/^Spot Corrubedo: \S.* ~1,1 m \(olas: modelo\)$/);
  });

  it('under 0,3 m it gives the state without a height', () => {
    const words = surf(0.25);
    expect(words).toMatch(/\(olas: modelo\)$/);
    expect(words).not.toMatch(/ m \(olas/);
  });

  it('with no wave data it says so', () => {
    seed(score(CORRUBEDO.id));
    render(<SpotMarkers />);
    expect(name('Corrubedo')).toMatch(/calculando condiciones|sin dato de olas/);
  });
});

describe('the figure inside a surf beach', () => {
  const figure = (shortName: string) => {
    const el = screen.getByRole('button', { name: new RegExp(`^Spot ${shortName}`) });
    return [...el.querySelectorAll('svg')].find((s) => s.querySelector('text'))!.querySelector('text')!.textContent;
  };
  const surf = (m: number) => {
    const s = score(CORRUBEDO.id);
    seed(s, buildSurfEntry(CORRUBEDO as never, swell(m), s, Date.now(), Date.now(), false));
    render(<SpotMarkers />);
  };

  it('is the height at the beach when there is one worth naming', () => {
    surf(1.3);
    expect(figure('Corrubedo')).toBe('~1,1');
  });

  it('is the state in a word under 0,3 m', () => {
    surf(0.25);
    expect(figure('Corrubedo')).toMatch(/^[A-ZÁÉÍÓÚ ]+$/);
  });

  it('is a dash while the wave has not arrived', () => {
    seed(score(CORRUBEDO.id));
    render(<SpotMarkers />);
    expect(figure('Corrubedo')).toBe('–');
  });
});
