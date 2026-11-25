/**
 * MobileSailingBanner smoke tests — ensures the component renders
 * without crashing with various store states.
 *
 * This component touches 4 Zustand stores (spot, sector, alert, ui).
 * A wrong selector would crash the entire app on mobile (no ErrorBoundary).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The band itself is tested with its service; here only «is there one or not» matters.
const lightning = vi.hoisted(() => ({ risks: [] as unknown[] }));
vi.mock('../../hooks/useSpotLightningRisk', () => ({
  useSpotLightningRisk: () => lightning.risks,
}));

import { MobileSailingBanner } from './MobileSailingBanner';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useAlertStore } from '../../store/alertStore';
import { ALL_SPOTS } from '../../config/spots';
import { SECTORS } from '../../config/sectors';
import { buildSurfEntry } from '../../services/surfVerdictEngine';
import type { SpotScore } from '../../services/spotScoringEngine';

describe('MobileSailingBanner', () => {
  beforeEach(() => {
    useSpotStore.setState({
      scores: new Map(),
      activeSpotId: '',
    });
    useAlertStore.setState({
      risk: { score: 0, severity: 'info', color: 'green', activeCount: 0 },
    });
    lightning.risks = [];
  });

  it('with no spot chosen and no scores it shows nothing, not the first of the list', () => {
    const { container } = render(<MobileSailingBanner />);
    expect(container.innerHTML).toBe('');
  });

  describe('with no spot chosen', () => {
    const scored = (verdict: string, kt: number) => ({
      verdict, provisional: false, hardGateTriggered: null, effectiveWindKt: kt,
      wind: { avgSpeedKt: kt, dominantDir: 'SW' },
    } as any);
    const rias = SECTORS.find((s) => s.id === 'rias')!;
    beforeEach(() => useSectorStore.setState({ activeSectorId: 'rias', activeSector: rias }));

    it('names the best spot of the sector', () => {
      useSpotStore.setState({
        activeSpotId: '',
        scores: new Map([['cesantes', scored('light', 7)], ['bocana', scored('good', 14)]]),
      });
      const { container } = render(<MobileSailingBanner />);
      const bocana = ALL_SPOTS.find((s) => s.id === 'bocana')!;
      expect(container.textContent).toContain(bocana.shortName);
      expect(container.textContent).toContain('14 kt');
    });

    it('shows nothing when every spot is in calm: there is no best', () => {
      useSpotStore.setState({
        activeSpotId: '',
        scores: new Map([['cesantes', scored('calm', 2)], ['bocana', scored('calm', 3)]]),
      });
      const { container } = render(<MobileSailingBanner />);
      expect(container.innerHTML).toBe('');
    });

    it('with a spot card open it shows nothing: the sheet below already says it', () => {
      useSpotStore.setState({
        activeSpotId: 'cesantes',
        scores: new Map([['cesantes', scored('calm', 2)], ['bocana', scored('good', 14)]]),
      });
      const { container } = render(<MobileSailingBanner />);
      expect(container.innerHTML).toBe('');
    });
  });

  it('hides under the lightning band: no «Calma» below «sal del agua»', () => {
    useSpotStore.setState({
      activeSpotId: '',
      scores: new Map([['cesantes', { verdict: 'good', provisional: false, hardGateTriggered: null, effectiveWindKt: 13, score: 70, wind: { avgSpeedKt: 13, dominantDir: 'SW' } } as any]]),
    });
    const before = render(<MobileSailingBanner />);
    expect(before.container.innerHTML).not.toBe('');
    before.unmount();

    lightning.risks = [{ spotId: 'cesantes', level: 'peligro' }];
    const { container } = render(<MobileSailingBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('renders without crashing in rias sector', () => {
    useSectorStore.setState({
      activeSector: {
        id: 'rias',
        coastal: true,
        name: 'Rías Baixas',
        center: [-8.68, 42.30],
        radiusKm: 40,
        regions: [],
      } as any,
    });

    const { container } = render(<MobileSailingBanner />);
    expect(container).toBeDefined();
  });

  it('returns null when critical alert is active', () => {
    useAlertStore.setState({
      risk: { score: 90, severity: 'critical', color: 'red', activeCount: 1 },
    });

    const { container } = render(<MobileSailingBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('renders with spot score data', () => {
    useSpotStore.setState({
      scores: new Map([
        ['cesantes', {
          verdict: 'good',
          provisional: false,
          hardGateTriggered: null,
          effectiveWindKt: 12,
          score: 70,
          wind: { avgSpeedKt: 12, dominantDir: 'SW' },
        } as any],
      ]),
      activeSpotId: '',
    });

    const { container } = render(<MobileSailingBanner />);
    expect(container.innerHTML).not.toBe('');
    expect(screen.getAllByText(/12 kt/).length).toBeGreaterThan(0);
  });

  // ── Surf spot: the pill says what its marker, row and card say ──
  describe('with a surf spot active', () => {
    const corrubedo = ALL_SPOTS.find((s) => s.id === 'surf-corrubedo')!;
    const rias = SECTORS.find((s) => s.id === 'rias')!;
    function surfScore(dirDeg: number, kt: number, hardGate: string | null): SpotScore {
      return {
        verdict: hardGate ? 'strong' : 'calm', provisional: false, hardGateTriggered: hardGate,
        effectiveWindKt: kt, summary: '',
        wind: { stationCount: 2, avgSpeedKt: kt, rawAvgSpeedKt: kt, dominantDir: 'NE', dirDeg, dirSteadiness: 0.9, matchedPattern: null, contributions: [] },
      } as unknown as SpotScore;
    }
    function seed(sc: SpotScore) {
      const t = Math.floor(Date.now() / 3_600_000) * 3_600_000;
      const hours = [0, 1, 2].map((i) => ({
        time: new Date(t + i * 3_600_000),
        waveHeight: 1.3, wavePeriod: 9, waveDirection: 315, swellHeight: 1.3, swellPeriod: 9, swellDirection: 315,
      }));
      useSectorStore.setState({ activeSectorId: 'rias', activeSector: rias });
      useSpotStore.setState({
        scores: new Map([['surf-corrubedo', sc]]),
        surfWaveCache: new Map([['surf-corrubedo', buildSurfEntry(corrubedo, hours, sc, Date.now(), Date.now())]]),
        activeSpotId: '',
      });
    }
    afterEach(() => useSpotStore.setState({ surfWaveCache: new Map() }));

    it('shows the surf verdict and the model height, not the wind verdict', () => {
      seed(surfScore(60, 4, null)); // NE: neutral at Corrubedo; 1.3 × 0.88 = 1.14 m
      const { container } = render(<MobileSailingBanner />);
      expect(container.textContent).toContain('SURF OK');
      expect(container.textContent).toContain('~1,1 m');
      expect(container.querySelector('button')!.getAttribute('aria-label')).toContain('~1,1 m de ola (modelo)');
      expect(container.textContent).not.toContain('Calma');
    });

    it('a beach closed by the engine hard gate is never named as the best', () => {
      seed(surfScore(315, 30, 'Viento 30kt > 25kt'));
      const { container } = render(<MobileSailingBanner />);
      expect(container.innerHTML).toBe('');
    });
  });
});

describe('MobileSailingBanner: what a tap opens', () => {
  it('simple mode opens the card of the spot it names, not the list that mode no longer has', async () => {
    const { useUIStore } = await import('../../store/uiStore');
    const { useSpotStore } = await import('../../store/spotStore');
    const { useSectorStore } = await import('../../store/sectorStore');
    const { getSpotsForSector } = await import('../../config/spots');
    const { fireEvent, render, screen } = await import('@testing-library/react');
    const spot = getSpotsForSector(useSectorStore.getState().activeSector.id)[0];
    useSpotStore.setState({
      activeSpotId: '',
      scores: new Map([[spot.id, { verdict: 'good', provisional: false, hardGateTriggered: null, effectiveWindKt: 13, wind: { avgSpeedKt: 13, dominantDir: 'SW' } } as any]]),
    });
    for (const simple of [true, false]) {
      useUIStore.setState({ simpleMode: simple, sidebarOpen: false });
      const selectSpot = vi.fn();
      useSpotStore.setState({ selectSpot });
      const view = render(<MobileSailingBanner />);
      fireEvent.click(screen.getByRole('button'));
      expect(selectSpot.mock.calls.length).toBe(simple ? 1 : 0);
      expect(useUIStore.getState().sidebarOpen).toBe(!simple);
      view.unmount();
    }
  });
});
