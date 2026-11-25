/**
 * Two lines of Historial that the random breaks of 12-nov went through with the whole suite green: a station chosen on
 * the map that the database does not have, and the note of the dotted line when nothing is being compared. Each test
 * was checked to fail with its break.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import { HistoryDashboard } from './HistoryDashboard';
import * as history from '../../api/historyClient';
import { SECTORS } from '../../config/sectors';
import { useSectorStore } from '../../store/sectorStore';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';

vi.mock('../../api/historyClient', () => ({
  fetchHistoryStations: vi.fn(),
  fetchBuoyStations: vi.fn(),
  fetchReadings: vi.fn(),
  fetchBuoyReadings: vi.fn(),
  fetchCompare: vi.fn(),
}));

const mocked = vi.mocked(history);
const isoAgo = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const select = () => screen.getByRole('combobox', { name: 'Estación o boya' }) as HTMLSelectElement;

beforeEach(() => {
  useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! });
  useWeatherStore.setState({
    stations: [
      { id: 'mg_14001', name: 'Porto de Vigo' },
      { id: 'mg_9', name: 'Sin Antena' },
      { id: 'wu_NODB', name: 'No está en la base' },
    ] as never,
  });
  useWeatherSelectionStore.setState({ historyStationId: null, selectedStationId: null });
  mocked.fetchHistoryStations.mockResolvedValue([
    { station_id: 'mg_14001', source: 'meteogalicia', last_reading: isoAgo(5), reading_count: 900 },
    { station_id: 'mg_9', source: 'meteogalicia', last_reading: '2026-10-30 09:10:00+01', reading_count: 3 },
  ]);
  mocked.fetchBuoyStations.mockResolvedValue([
    { station_id: 1250, station_name: 'Cortegada (Arousa)', source: 'portus', last_reading: isoAgo(60), reading_count: 87 },
    { station_id: 1250, station_name: 'Cortegada (Arousa)', source: 'obscosteiro', last_reading: isoAgo(10), reading_count: 21479 },
    { station_id: 1250, station_name: 'Cortegada (Arousa)', source: 'intecmar', last_reading: isoAgo(600), reading_count: 23 },
    { station_id: 3223, station_name: 'Marín (marea)', source: 'portus', last_reading: isoAgo(10), reading_count: 100 },
  ] as never);
  mocked.fetchReadings.mockImplementation(async (id: string) => (id === 'mg_14001'
    ? [200, 150, 90, 80, 30, 10].map((min, i) => ({ time: isoAgo(min), temperature: [8.8, 15.1, 13, 13, 12.3, 12.3][i], wind_speed: 3, wind_gust: 5, humidity: 60, pressure: 1016, dew_point: 5, solar_rad: 100 }))
    : []) as never);
  mocked.fetchBuoyReadings.mockImplementation(async (id: number) => (id === 1250
    ? [30, 20, 10].map((min) => ({ time: isoAgo(min), wave_height: null, wind_speed: 5, wind_gust: 6, water_temp: 14, air_temp: 12, salinity: 34.3, humidity: 65, dew_point: 5.6 }))
    : [{ time: isoAgo(10), wave_height: 0.02, wave_period: 2.6, wind_speed: 0.8, air_pressure: 1015, sea_level: 3.27 }]) as never);
  mocked.fetchCompare.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Historial, what it opens with', () => {
  it('a station chosen on the map that the database lacks does not stay chosen: the first one with data opens', async () => {
    useWeatherSelectionStore.setState({ historyStationId: null, selectedStationId: 'wu_NODB' });
    render(<HistoryDashboard />);
    // The list shows its first option whatever is chosen: what counts is the station whose data is asked for
    await waitFor(() => expect(mocked.fetchReadings.mock.calls.map((c) => c[0])).toContain('mg_14001'));
    expect(mocked.fetchReadings.mock.calls.map((c) => c[0])).not.toContain('wu_NODB');
  });

  it('a station chosen on the map that the database has opens it', async () => {
    useWeatherSelectionStore.setState({ historyStationId: null, selectedStationId: 'mg_9' });
    render(<HistoryDashboard />);
    await waitFor(() => expect(select().value).toBe('mg_9'));
  });

  it('with nothing compared there is no note about a dotted line', async () => {
    const { container } = render(<HistoryDashboard />);
    await waitFor(() => expect(container.querySelector('.gc-chart')).not.toBeNull());
    expect(container.textContent).not.toContain('Línea de puntos');
  });
});

describe('Historial, the dates', () => {
  it('the date fields only appear after «Fechas»', async () => {
    const { container } = render(<HistoryDashboard />);
    await waitFor(() => expect(container.querySelector('.gc-chart')).not.toBeNull());
    expect(container.querySelector('input[type="date"]')).toBeNull();
    screen.getByRole('button', { name: 'Fechas' }).click();
    await waitFor(() => expect(container.querySelectorAll('input[type="date"]')).toHaveLength(2));
  });
});

describe('Historial, a station that sent nothing', () => {
  it('asked for from outside and missing from the database, it is named by its own name', async () => {
    useWeatherSelectionStore.setState({ historyStationId: 'wu_NODB', selectedStationId: null });
    const { container } = render(<HistoryDashboard />);
    await waitFor(() => expect(container.textContent).toMatch(/No está en la base no ha enviado/));
  });
});
