/**
 * Header smoke tests — ensures the component renders
 * without crashing with various store states.
 *
 * Header touches 4 stores (weather, sector, thermal, ui)
 * plus forecast store. A wrong selector crashes the entire app.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Header } from './Header';
import { useUIStore } from '../../store/uiStore';
import { useWeatherStore } from '../../store/weatherStore';
import { useSectorStore } from '../../store/sectorStore';
import { useThermalStore } from '../../store/thermalStore';

describe('Header', () => {
  const defaultProps = {
    onRefresh: () => {},
    fieldDrawerOpen: false,
    onToggleFieldDrawer: () => {},
    fieldAlertLevel: 'none' as const,
  };

  beforeEach(() => {
    useWeatherStore.setState({
      stations: [],
      currentReadings: new Map(),
    });
    useThermalStore.setState({
      rules: [],
    });
  });

  it('renders without crashing with empty stores', () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
  });

  it('renders in embalse sector', () => {
    render(<Header {...defaultProps} />);
    // Default sector is embalse
    expect(screen.getByText(/Interior/i)).toBeDefined();
  });

  it('renders in rias sector', () => {
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

    render(<Header {...defaultProps} />);
    expect(screen.getByText(/Rías/i)).toBeDefined();
  });

  it('renders with station data', () => {
    useWeatherStore.setState({
      stations: [
        { id: 'test_1', name: 'Test', source: 'aemet', lat: 42.3, lon: -8.7, altitude: 100 } as any,
      ],
      currentReadings: new Map([
        ['test_1', { temperature: 15, windSpeed: 5 } as any],
      ]),
    });

    render(<Header {...defaultProps} />);
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
  });
});

describe('Header sun times (review, 18-nov)', () => {
  it('follow the day: the installed app stays open for days and they stayed on the first one', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 10, 18, 12, 0));
      useUIStore.setState({ isMobile: false });
      render(<Header onRefresh={() => {}} fieldDrawerOpen={false} onToggleFieldDrawer={() => {}} fieldAlertLevel="none" />);
      const read = () => document.querySelector('.gc-meta span')?.textContent;
      const first = read();
      expect(first).toMatch(/\d{2}:\d{2} \/ \d{2}:\d{2}/);
      // A month later, with the page still open: the next tick of the clock brings the new day
      vi.setSystemTime(new Date(2026, 11, 18, 12, 0));
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(read()).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });
});
