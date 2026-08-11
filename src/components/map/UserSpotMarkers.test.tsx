/**
 * Guardrail for the whole map, not just for these markers.
 *
 * This component had zero coverage, and that is exactly why a missing import
 * survived a green build: `npm run build` uses esbuild, which does not resolve
 * free identifiers, and the project's root tsconfig is a solution file, so
 * `tsc --noEmit` typechecks NOTHING and exits 0 (`tsc -b` is the real gate).
 *
 * What made it dangerous rather than merely broken: the `mine.length === 0`
 * early return hides the fault until the user drops their first pin, and pins
 * live in localStorage — so the ErrorBoundary swallows the entire map on every
 * reload, and the only button that deletes a pin lives inside the dead subtree.
 * No way out from inside the app.
 *
 * One render with a pin present is all it takes to catch that class of fault,
 * because the map callback that computes the verdict runs during THIS render,
 * before <Marker> is ever invoked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';

// The shared setup stubs Marker as `() => null`, which is enough to catch a
// throw (the callback that computes the verdict runs during this render, before
// Marker is called) but leaves the DOM empty, so nothing can be read back.
// Here the children are rendered so the badge text can actually be asserted.
vi.mock('react-map-gl/maplibre', () => ({
  Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ current: null }),
}));

import { UserSpotMarkers } from './UserSpotMarkers';
import { useUserSpotStore } from '../../store/userSpotStore';
import { useSectorStore } from '../../store/sectorStore';
import type { SpotScore } from '../../services/spotScoringEngine';

function seedPin(sectorId: string) {
  useSectorStore.setState((s) => ({
    activeSector: { ...s.activeSector, id: sectorId },
  }) as never);
  useUserSpotStore.setState({
    userSpots: [{
      id: 'user-test-1',
      name: 'Mi sitio',
      center: [-8.75, 42.32],
      sectorId,
      createdAt: Date.now(),
    }],
    selectedUserSpotId: null,
  } as never);
}

function scoreWith(partial: Partial<SpotScore>): SpotScore {
  return {
    spotId: 'user-test-1',
    verdict: 'sailing',
    score: 50,
    summary: '',
    wind: { avgSpeedKt: 9, dominantDir: 'NE', dirDeg: 45, stationCount: 3 },
    ...partial,
  } as SpotScore;
}

describe('UserSpotMarkers', () => {
  beforeEach(() => {
    useUserSpotStore.setState({ userSpots: [], scores: new Map() } as never);
  });

  it('renders a pin without throwing', () => {
    seedPin(useSectorStore.getState().activeSector.id);
    useUserSpotStore.setState({
      scores: new Map([['user-test-1', scoreWith({ effectiveWindKt: 9 })]]),
    } as never);

    // A ReferenceError from a helper that was never imported surfaces here.
    expect(() => render(<UserSpotMarkers />)).not.toThrow();
  });

  it('renders a provisional pin without throwing, and says so instead of a dash', () => {
    seedPin(useSectorStore.getState().activeSector.id);
    useUserSpotStore.setState({
      scores: new Map([['user-test-1', scoreWith({ verdict: 'good', effectiveWindKt: 14, provisional: true })]]),
    } as never);

    const { container } = render(<UserSpotMarkers />);
    // Provisional collapses the verdict to neutral; the badge must not keep
    // claiming BUENO, and it must not fall back to the local map's '—' either,
    // which reads as "no data" rather than "not finished yet".
    expect(container.textContent).not.toContain('BUENO');
    expect(container.textContent).toContain('Calculando');
  });

  it('renders nothing when the user has no pins in the active sector', () => {
    const { container } = render(<UserSpotMarkers />);
    expect(container.textContent).toBe('');
  });
});
