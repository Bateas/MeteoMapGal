/**
 * Contract tests for a pin the user dropped (17-nov, zone 3 of the plan): its badge gives the knots only with a
 * verdict worth them, and the open one is the bigger. They cover breaks the full sweep of 12-nov left alive in
 * UserSpotMarkers.tsx. Each was checked to fail with its break put in.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('react-map-gl/maplibre', () => ({
  Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ current: null }),
}));

import { UserSpotMarkers } from './UserSpotMarkers';
import { useUserSpotStore } from '../../store/userSpotStore';
import { useSectorStore } from '../../store/sectorStore';
import type { SpotScore } from '../../services/spotScoringEngine';

const PIN = 'user-test-1';
function seed(over: Partial<SpotScore>, selected: string | null = null) {
  const sectorId = useSectorStore.getState().activeSector.id;
  useUserSpotStore.setState({
    userSpots: [{ id: PIN, name: 'Mi sitio', center: [-8.75, 42.32], sectorId, createdAt: Date.now() }],
    selectedUserSpotId: selected,
    scores: new Map([[PIN, { spotId: PIN, verdict: 'sailing', score: 50, summary: '', wind: { avgSpeedKt: 9, dominantDir: 'NE', dirDeg: 45, stationCount: 3 }, effectiveWindKt: 9, ...over } as SpotScore]]),
  } as never);
}
/** Only the pin dropped by the user: the sector weather points render beside it. */
const pin = () => document.querySelector('[title="Mi sitio (sin calibrar)"]')!;
const badge = () => pin().querySelector('.whitespace-nowrap')?.textContent ?? '';
const pinSize = () => (pin().querySelector('.rounded-full') as HTMLElement).style.width;

beforeEach(() => useUserSpotStore.setState({ userSpots: [], scores: new Map(), selectedUserSpotId: null } as never));
afterEach(cleanup);

describe('the badge of a pin', () => {
  it.each([
    ['a sailing wind gives its knots', 'sailing', /\b9kt$/],
    ['calm gives no knots', 'calm', /^[^\d]*$/],
    ['no verdict gives no knots', 'unknown', /^[^\d]*$/],
  ] as const)('%s', (_, verdict, re) => {
    seed({ verdict });
    render(<UserSpotMarkers />);
    expect(badge()).toMatch(re);
  });
});

describe('the open pin', () => {
  it('is bigger than a closed one', () => {
    seed({}, PIN);
    render(<UserSpotMarkers />);
    expect(pinSize()).toBe('38px');
    cleanup();
    seed({}, null);
    render(<UserSpotMarkers />);
    expect(pinSize()).toBe('32px');
  });
});
