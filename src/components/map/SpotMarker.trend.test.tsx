import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ inkCalls: 0 }));

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

vi.mock('../../hooks/useMapInk', () => ({
  useMapInk: () => { h.inkCalls++; return { text: '#fff', halo: '#000', shadow: 'none' }; },
}));

import { SpotMarkers } from './SpotMarker';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { SECTORS } from '../../config/sectors';
import { getSpotsForSector } from '../../config/spots';

const rias = getSpotsForSector('rias');
const sail = rias.filter((s) => s.category !== 'surf');
const surf = rias.find((s) => s.category === 'surf')!;

const score = (spotId: string, over: Record<string, unknown> = {}) => ({
  spotId, verdict: 'good', wind: { avgSpeedKt: 12, dominantDir: 'NE', dirDeg: 45, stationCount: 3 }, effectiveWindKt: 12, windTrend: null, computedAt: new Date(), ...over,
});

/** kt an hour ago and kt now, with enough readings on each side for the rule to speak */
const history = (then: number, now: number) => {
  const t = Date.now();
  return [
    { ts: t - 70 * 60_000, kt: then }, { ts: t - 60 * 60_000, kt: then },
    { ts: t - 20 * 60_000, kt: now }, { ts: t - 10 * 60_000, kt: now },
  ];
};

function seed(scores: [string, unknown][], hist: [string, unknown][]) {
  useSpotStore.setState({ scores: new Map(scores), windHistory: new Map(hist) } as never);
}

const nameOf = (spot: { shortName: string }) => screen.getByRole('button', { name: new RegExp(`^Spot ${spot.shortName}`) }).getAttribute('aria-label');

describe('trend arrow on the spot marker', () => {
  beforeEach(() => {
    useSectorStore.setState({ activeSector: SECTORS.find((s) => s.id === 'rias')! } as never);
    h.inkCalls = 0;
  });
  afterEach(() => {
    cleanup();
    useSpotStore.setState({ scores: new Map(), windHistory: new Map() } as never);
  });

  it('going up: draws the arrow and says it', () => {
    const [a] = sail;
    seed([[a.id, score(a.id)]], [[a.id, history(6, 12)]]);
    render(<SpotMarkers />);
    expect(nameOf(a)).toBe(`Spot ${a.shortName}: Bueno 12 kt del NE, sube`);
    expect(document.querySelector(`[aria-label^="Spot ${a.shortName}"] svg path[d^="M2.5 9.5"]`)).not.toBeNull();
  });

  it('going down', () => {
    const [a] = sail;
    seed([[a.id, score(a.id)]], [[a.id, history(18, 12)]]);
    render(<SpotMarkers />);
    expect(nameOf(a)).toBe(`Spot ${a.shortName}: Bueno 12 kt del NE, baja`);
    expect(document.querySelector(`[aria-label^="Spot ${a.shortName}"] svg path[d^="M2.5 2.5"]`)).not.toBeNull();
  });

  it('the stations moving together win over the run of figures', () => {
    const [a] = sail;
    seed([[a.id, score(a.id, { windTrend: { signal: 'rapid' } })]], [[a.id, history(12, 12)]]);
    render(<SpotMarkers />);
    expect(nameOf(a)).toContain(', sube');
  });

  it('holding, or without enough readings: nothing', () => {
    const [a, b] = sail;
    seed([[a.id, score(a.id)], [b.id, score(b.id)]], [[a.id, history(12, 12)]]);
    render(<SpotMarkers />);
    expect(nameOf(a)).toBe(`Spot ${a.shortName}: Bueno 12 kt del NE`);
    expect(nameOf(b)).toBe(`Spot ${b.shortName}: Bueno 12 kt del NE`);
  });

  it('not once the score is old, like the list', () => {
    const [a] = sail;
    seed([[a.id, score(a.id, { computedAt: new Date(Date.now() - 91 * 60_000), windTrend: { signal: 'rapid' } })]], [[a.id, history(6, 12)]]);
    render(<SpotMarkers />);
    expect(nameOf(a)).toBe(`Spot ${a.shortName}: Bueno 12 kt del NE`);
  });

  it('the clock takes it away if the readings stop', () => {
    vi.useFakeTimers();
    try {
      const [a] = sail;
      seed([[a.id, score(a.id, { computedAt: new Date(Date.now() - 89 * 60_000), windTrend: { signal: 'rapid' } })]], []);
      render(<SpotMarkers />);
      expect(nameOf(a)).toContain(', sube');
      act(() => { vi.advanceTimersByTime(2 * 60_000 + 1); });
      expect(nameOf(a)).toBe(`Spot ${a.shortName}: Bueno 12 kt del NE`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('not while the spot is provisional', () => {
    const [a] = sail;
    seed([[a.id, score(a.id, { provisional: true })]], [[a.id, history(6, 12)]]);
    render(<SpotMarkers />);
    expect(nameOf(a)).toBe(`Spot ${a.shortName}: calculando condiciones`);
  });

  it('not on surf, where the figure is the wave', () => {
    seed([[surf.id, score(surf.id)]], [[surf.id, history(6, 12)]]);
    render(<SpotMarkers />);
    expect(nameOf(surf)).not.toMatch(/sube|baja/);
  });

  it('not on a spot closed by the sea, where the figure is the wave too', () => {
    const [a] = sail;
    seed(
      [[a.id, score(a.id, { verdict: 'strong', hardGateKind: 'wave', hardGateTriggered: 'Oleaje 3 m > 2 m', waves: { waveHeight: 3 } })]],
      [[a.id, history(6, 12)]],
    );
    render(<SpotMarkers />);
    expect(nameOf(a)).not.toMatch(/sube|baja/);
  });

  it('a new reading repaints only the marker that changed', () => {
    const [a, b] = sail;
    const hist: [string, unknown][] = [[a.id, history(6, 12)], [b.id, history(12, 12)]];
    seed([[a.id, score(a.id)], [b.id, score(b.id)]], hist);
    render(<SpotMarkers />);

    // Same figures in new objects, as every poll hands over: nobody repaints
    h.inkCalls = 0;
    act(() => { seed([[a.id, score(a.id)], [b.id, score(b.id)]], hist); });
    expect(h.inkCalls).toBe(0);

    // The arrow of one spot goes away: only that one
    act(() => { seed([[a.id, score(a.id)], [b.id, score(b.id)]], [[a.id, history(12, 12)], [b.id, history(12, 12)]]); });
    expect(h.inkCalls).toBe(1);
    expect(nameOf(a)).toBe(`Spot ${a.shortName}: Bueno 12 kt del NE`);
  });
});
