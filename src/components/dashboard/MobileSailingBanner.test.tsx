/**
 * MobileSailingBanner smoke tests — ensures the component renders
 * without crashing with various store states.
 *
 * This component touches 4 Zustand stores (spot, sector, alert, ui).
 * A wrong selector would crash the entire app on mobile (no ErrorBoundary).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
      activeSpotId: null,
    });
    useAlertStore.setState({
      risk: { score: 0, severity: 'info', color: 'green', activeCount: 0 },
    });
  });

  it('renders without crashing with empty stores', () => {
    const { container } = render(<MobileSailingBanner />);
    // With default sector (embalse) and empty scores, still renders spot name
    expect(container).toBeDefined();
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
          score: 70,
          wind: { avgSpeedKt: 12, dominantDir: 'SW' },
        } as any],
      ]),
      activeSpotId: 'cesantes',
    });

    const { container } = render(<MobileSailingBanner />);
    expect(container.innerHTML).not.toBe('');
    expect(screen.getAllByText(/12kt/).length).toBeGreaterThan(0);
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
        activeSpotId: 'surf-corrubedo',
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

    it('over the engine hard gate it reads the wind verdict like any spot', () => {
      seed(surfScore(315, 30, 'Viento 30kt > 25kt'));
      const { container } = render(<MobileSailingBanner />);
      expect(container.textContent).toContain('Fuerte');
      expect(container.textContent).not.toContain('SURF OK');
    });
  });
});
