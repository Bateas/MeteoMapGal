/**
 * Header smoke tests — ensures the component renders
 * without crashing with various store states.
 *
 * Header touches 4 stores (weather, sector, thermal, ui)
 * plus forecast store. A wrong selector crashes the entire app.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Header } from './Header';
import { useWeatherStore } from '../../store/weatherStore';
import { useSectorStore } from '../../store/sectorStore';
import { useThermalStore } from '../../store/thermalStore';

describe('Header', () => {
  const defaultProps = {
    onRefresh: () => {},
    fieldDrawerOpen: false,
    onToggleFieldDrawer: () => {},
    fieldAlertLevel: 'none' as const,
    windFront: null,
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
    expect(screen.getByText(/Embalse/i)).toBeDefined();
  });

  it('renders in rias sector', () => {
    useSectorStore.setState({
      activeSector: {
        id: 'rias',
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

  it('renders with wind front info', () => {
    render(
      <Header
        {...defaultProps}
        windFront={{ active: true, etaMin: 15, directionLabel: 'NW', frontSpeedKt: 12 }}
      />
    );
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
  });
});
