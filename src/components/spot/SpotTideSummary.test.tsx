import { __clearTideCacheForTests } from '../../hooks/useMeteoTide';
/**
 * SpotTideSummary — the meteorological tide line.
 *
 * The line only earns its place when it contradicts the table above it, so
 * these tests care as much about when it stays quiet as about when it speaks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SpotTideSummary } from './SpotTideSummary';
import { useBuoyStore } from '../../store/buoyStore';
import type { TidePoint } from '../../api/tideClient';
import type { BuoyReading } from '../../api/buoyClient';

vi.mock('../../api/tideClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/tideClient')>();
  return { ...actual, fetchTidePredictions: vi.fn(), fetchTides48h: vi.fn() };
});

import { fetchTidePredictions, fetchTides48h } from '../../api/tideClient';

// Real IHM Vigo predictions for 19 and 20 July 2026
const JUL19: TidePoint[] = [
  { time: '00:11', height: 0.623, type: 'low' },
  { time: '06:22', height: 3.195, type: 'high' },
  { time: '12:18', height: 0.827, type: 'low' },
  { time: '18:39', height: 3.382, type: 'high' },
];
const JUL20: TidePoint[] = [
  { time: '00:54', height: 0.845, type: 'low' },
  { time: '07:07', height: 3.020, type: 'high' },
  { time: '13:04', height: 1.020, type: 'low' },
  { time: '19:25', height: 3.124, type: 'high' },
];

/** Real BuoyReading shape for the Vigo tide gauge. */
function vigoGauge(seaLevelCm: number | null): BuoyReading {
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

describe('SpotTideSummary — meteorological tide line', () => {
  beforeEach(() => {
    __clearTideCacheForTests();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-19T15:00:00'));
    vi.mocked(fetchTidePredictions).mockResolvedValue(JUL19);
    vi.mocked(fetchTides48h).mockResolvedValue({ today: JUL19, tomorrow: JUL20 });
    useBuoyStore.setState({ buoys: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('says how far the water is from the table when the gap is real', async () => {
    // Astronomical at 15:00 is near 1.81m — 231cm is roughly half a metre over
    useBuoyStore.setState({ buoys: [vigoGauge(231)] });
    render(<SpotTideSummary tideStationId="29" />);

    expect(await screen.findByText(/por encima de tabla/)).toBeInTheDocument();
  });

  it('stays quiet when the water sits where the table says', async () => {
    useBuoyStore.setState({ buoys: [vigoGauge(181)] });
    render(<SpotTideSummary tideStationId="29" />);

    await screen.findByText(/Mareas hoy/);
    await waitFor(() => expect(fetchTides48h).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByText(/tabla/)).toBeNull();
  });

  it('does not even ask for predictions when no gauge reports a level', async () => {
    useBuoyStore.setState({ buoys: [vigoGauge(null)] });
    render(<SpotTideSummary tideStationId="29" />);

    await screen.findByText(/Mareas hoy/);
    expect(fetchTides48h).not.toHaveBeenCalled();
    expect(screen.queryByText(/tabla/)).toBeNull();
  });

  it('lets ?simsurge force the line through the real pipeline, gauge or not', async () => {
    // No buoy reporting at all — the debug aid has to survive a silent PORTUS
    window.history.replaceState({}, '', '/?simsurge=250');
    render(<SpotTideSummary tideStationId="29" />);

    expect(await screen.findByText(/por encima de tabla/)).toBeInTheDocument();
  });

  it('leaves the tide table itself untouched', async () => {
    useBuoyStore.setState({ buoys: [vigoGauge(231)] });
    render(<SpotTideSummary tideStationId="29" />);

    expect(await screen.findByText(/06:22/)).toBeInTheDocument();
    expect(screen.getByText(/18:39/)).toBeInTheDocument();
  });
});
