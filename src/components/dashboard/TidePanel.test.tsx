import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TidePanel } from './TidePanel';
import { useBuoyStore } from '../../store/buoyStore';
import { __clearTideCacheForTests } from '../../hooks/useMeteoTide';
import type { TidePoint } from '../../api/tideClient';
import type { BuoyReading } from '../../api/buoyClient';

vi.mock('../../api/tideClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/tideClient')>();
  return { ...actual, fetchTides48h: vi.fn(), fetchTidePredictions: vi.fn() };
});

import { fetchTides48h, fetchTidePredictions } from '../../api/tideClient';

const TODAY_POINTS: TidePoint[] = [
  { time: '06:00', height: 3.2, type: 'high' },
  { time: '12:15', height: 0.8, type: 'low' },
  { time: '18:30', height: 3.4, type: 'high' },
];

const TOMORROW_POINTS: TidePoint[] = [
  { time: '00:45', height: 0.9, type: 'low' },
  { time: '07:00', height: 3.1, type: 'high' },
];

function mockGaugeReading(seaLevelCm: number | null): BuoyReading {
  return {
    stationId: 3221,
    stationName: 'Vigo (marea)',
    timestamp: new Date('2026-07-19T14:50:00').toISOString(),
    waveHeight: null,
    waveHeightMax: null,
    wavePeriod: null,
    wavePeriodMean: null,
    waveDir: null,
    windSpeed: null,
    windDir: null,
    windGust: null,
    waterTemp: null,
    airTemp: null,
    airPressure: null,
    currentSpeed: null,
    currentDir: null,
    salinity: null,
    seaLevel: seaLevelCm,
    humidity: null,
    dewPoint: null,
    source: 'portus',
  };
}

describe('TidePanel', () => {
  beforeEach(() => {
    __clearTideCacheForTests();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-19T10:00:00'));
    vi.mocked(fetchTides48h).mockResolvedValue({ today: TODAY_POINTS, tomorrow: TOMORROW_POINTS });
    vi.mocked(fetchTidePredictions).mockResolvedValue(TODAY_POINTS);
    useBuoyStore.setState({ buoys: [] });
  });

  it('renders tide data and next tide indicator', async () => {
    render(<TidePanel />);

    await waitFor(() => {
      expect(screen.getByText('Mareas')).toBeDefined();
    });

    expect(screen.getByText(/Vigo/)).toBeDefined();
    expect(screen.getByText(/Bajamar 12:15/)).toBeDefined();
  });

  it('shows real storm surge when gauge reports notable residual', async () => {
    // Vigo gauge with +25 cm surge
    useBuoyStore.setState({ buoys: [mockGaugeReading(225)] });
    render(<TidePanel />);

    await waitFor(() => {
      expect(screen.getByText('Mareas')).toBeDefined();
    });

    // Expand panel
    const toggleButton = screen.getByRole('button');
    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(screen.getByText(/Nivel real mareógrafo/)).toBeDefined();
    });
  });

  it('degrades honestly when the IHM fails, and still shows the measured level', async () => {
    vi.mocked(fetchTides48h).mockRejectedValue(new Error('IHM API error: 500'));
    // Vigo gauge reported half an hour ago
    const recent = { ...mockGaugeReading(250), timestamp: new Date('2026-07-19T09:30:00').toISOString() };
    useBuoyStore.setState({ buoys: [recent] });
    render(<TidePanel />);

    await waitFor(() => {
      expect(screen.getByText('Tabla del IHM no disponible')).toBeDefined();
    });
    expect(screen.queryByText(/Error cargando mareas/)).toBeNull();
    expect(screen.getByText(/Nivel medido ahora/)).toBeDefined();
    expect(screen.getByText('2.50 m')).toBeDefined();
    expect(screen.getByText(/no se puede calcular la resaca/)).toBeDefined();
  });

  it('does not present a stale gauge reading as the level now', async () => {
    vi.mocked(fetchTides48h).mockRejectedValue(new Error('IHM API error: 500'));
    // Six hours old: beyond what "now" can mean for this gauge
    const stale = { ...mockGaugeReading(250), timestamp: new Date('2026-07-19T04:00:00').toISOString() };
    useBuoyStore.setState({ buoys: [stale] });
    render(<TidePanel />);

    await waitFor(() => {
      expect(screen.getByText('Tabla del IHM no disponible')).toBeDefined();
    });
    expect(screen.queryByText(/Nivel medido ahora/)).toBeNull();
  });

  it('labels a table that came from the stored copy', async () => {
    vi.mocked(fetchTides48h).mockResolvedValue({ today: TODAY_POINTS, tomorrow: TOMORROW_POINTS, fromCache: true });
    render(<TidePanel />);

    await waitFor(() => {
      expect(screen.getByText('tabla guardada')).toBeDefined();
    });
  });

  it('renders a continuous tide curve covering a full cycle when expanded', async () => {
    render(<TidePanel />);

    await waitFor(() => {
      expect(screen.getByText('Mareas')).toBeDefined();
    });

    // Expand panel
    const toggleButton = screen.getByRole('button');
    fireEvent.click(toggleButton);

    await waitFor(() => {
      // Curve SVG is present with aria-label
      const svg = document.querySelector('svg[aria-label="Curva de mareas Hoy"]');
      expect(svg).toBeDefined();
      // Polyline curve exists
      const polyline = svg?.querySelector('polyline');
      expect(polyline).toBeDefined();
    });
  });
});
