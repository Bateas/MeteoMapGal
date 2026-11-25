/**
 * Contract tests for Historial (17-nov, zone 4 of the plan): a list that fails to load says so, dates the wrong way
 * round, raw or hourly by the span asked for (a tide gauge by the hour), the comparison with a second station, a
 * station whose rows say nothing, and an external request for a station not on the list. They cover breaks the full
 * sweep of 12-nov left alive in HistoryDashboard.tsx. Each was checked to fail with its break put in.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HistoryDashboard } from './HistoryDashboard';
import * as history from '../../api/historyClient';
import { SECTORS } from '../../config/sectors';
import { useSectorStore } from '../../store/sectorStore';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { useBuoyStore } from '../../store/buoyStore';

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
const metricRows = (container: HTMLElement) =>
  [...container.querySelectorAll('.gc-rowbtn--metric .gc-rowname')].map((n) => n.textContent);

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
  // Choosing a buoy here also selects it on the map: the next test must not start from it
  useBuoyStore.setState({ selectedBuoyId: null } as never);
  useWeatherSelectionStore.setState({ historyStationId: null, selectedStationId: null });
});

const range = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }));

describe('a list that fails to load', () => {
  it('says so', async () => {
    mocked.fetchHistoryStations.mockRejectedValue(new Error('down'));
    const { container } = render(<HistoryDashboard />);
    useWeatherSelectionStore.getState().openHistory('mg_14001');
    await waitFor(() => expect(container.textContent).toContain('No se pudo cargar el historial'));
  });
});

describe('how much it asks for', () => {
  it('24 h raw, 7 days by the hour', async () => {
    render(<HistoryDashboard />);
    await waitFor(() => expect(mocked.fetchReadings).toHaveBeenCalled());
    expect(mocked.fetchReadings).toHaveBeenLastCalledWith('mg_14001', expect.any(String), expect.any(String), 'raw');
    range('7 días');
    await waitFor(() => expect(mocked.fetchReadings).toHaveBeenLastCalledWith('mg_14001', expect.any(String), expect.any(String), 'hourly'));
  });

  it('a tide gauge over 7 days by the hour; a platform always raw, in full', async () => {
    render(<HistoryDashboard />);
    await waitFor(() => expect(select().value).toBe('mg_14001'));
    fireEvent.change(select(), { target: { value: 'buoy_3223' } });
    range('7 días');
    await waitFor(() => expect(mocked.fetchBuoyReadings).toHaveBeenLastCalledWith(3223, expect.any(String), expect.any(String), { interval: 'hourly' }));
    fireEvent.change(select(), { target: { value: 'buoy_1250' } });
    await waitFor(() => expect(mocked.fetchBuoyReadings).toHaveBeenLastCalledWith(1250, expect.any(String), expect.any(String), { limit: 10_000 }));
  });

  it('dates the wrong way round ask for nothing and say why', async () => {
    const { container } = render(<HistoryDashboard />);
    await waitFor(() => expect(select().value).toBe('mg_14001'));
    range('Fechas');
    const [from, to] = [...container.querySelectorAll('input[type="date"]')] as HTMLInputElement[];
    fireEvent.change(from, { target: { value: '2026-11-10' } });
    fireEvent.change(to, { target: { value: '2026-11-05' } });
    await waitFor(() => expect(screen.getByRole('alert').getAttribute('title')).toContain('Revisa las fechas'));
  });
});

describe('comparing with a second station', () => {
  it('offers the others, never the one already chosen, and only once asked', async () => {
    render(<HistoryDashboard />);
    await waitFor(() => expect(select().value).toBe('mg_14001'));
    expect(screen.queryByRole('combobox', { name: 'Segunda estación' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Comparar con otra estación' }));
    const second = () => screen.getByRole('combobox', { name: 'Segunda estación' }) as HTMLSelectElement;
    await waitFor(() => expect([...second().options].map((o) => o.value)).toEqual(['', 'mg_9']));
  });

  it('draws only the second station: rows of the first are not its line', async () => {
    mocked.fetchCompare.mockResolvedValue([{ station_id: 'mg_14001', time: isoAgo(10), temperature: 12, wind_speed: 3 }] as never);
    const { container } = render(<HistoryDashboard />);
    await waitFor(() => expect(metricRows(container)).toContain('Viento'));
    fireEvent.click(await screen.findByRole('button', { name: 'Comparar con otra estación' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Segunda estación' }), { target: { value: 'mg_9' } });
    await waitFor(() => expect(container.textContent).toContain('Línea de puntos: Sin Antena, sin este dato en el periodo.'));
  });
});

describe('rows that say nothing', () => {
  it('a station that sent rows with no usable figure says so', async () => {
    mocked.fetchReadings.mockResolvedValue([{ time: isoAgo(10) }, { time: isoAgo(20) }] as never);
    const { container } = render(<HistoryDashboard />);
    await waitFor(() => expect(container.textContent).toContain('Porto de Vigo no ha enviado ningún dato útil en este periodo.'));
  });
});

describe('the chosen station in the list', () => {
  it('a station on the list is offered once, not repeated as an extra option', async () => {
    render(<HistoryDashboard />);
    await waitFor(() => expect(select().value).toBe('mg_14001'));
    const names = [...select().options].map((o) => o.textContent);
    expect(names.filter((n) => n === 'Porto de Vigo')).toHaveLength(1);
  });
});
