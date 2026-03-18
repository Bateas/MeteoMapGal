/**
 * MobileSailingBanner smoke tests — ensures the component renders
 * without crashing with various store states.
 *
 * This component touches 4 Zustand stores (spot, sector, alert, ui).
 * A wrong selector would crash the entire app on mobile (no ErrorBoundary).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MobileSailingBanner } from './MobileSailingBanner';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useAlertStore } from '../../store/alertStore';

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
});
