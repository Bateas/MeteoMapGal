/**
 * Historial, with what the API answers: a buoy once and by its name however many sources it has, only the
 * magnitudes that station sent, the sentence first, and a station with no data saying so.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
});

describe('Historial', () => {
  it('lists a buoy once, by its name, and a station only if the database has it', async () => {
    render(<HistoryDashboard />);
    await waitFor(() => expect(select().value).toBe('mg_14001'));
    const names = [...select().options].map((o) => o.textContent);
    expect(names.filter((n) => n === 'Cortegada (Arousa)')).toHaveLength(1);
    expect(names).toContain('Porto de Vigo');
    expect(names).not.toContain('No está en la base');
    expect(names.join()).not.toMatch(/buoy_|lecturas/);
  });

  it('a station: what it sent, the wind first, and no table of figures with what it lacks', async () => {
    const { container } = render(<HistoryDashboard />);
    await waitFor(() => expect(metricRows(container)).toContain('Viento'));
    expect(metricRows(container)).toEqual(['Viento', 'Temperatura', 'Humedad', 'Presión', 'Punto de rocío', 'Radiación']);
    expect(container.textContent).not.toContain('lecturas');
    expect(container.textContent).not.toContain('Rosa');
    expect(container.querySelector('.gc-chart')).not.toBeNull();
  });

  it('tapping a magnitude says it and draws it: the sentence goes first', async () => {
    const { container } = render(<HistoryDashboard />);
    await waitFor(() => expect(metricRows(container)).toContain('Temperatura'));
    fireEvent.click(within(container).getByRole('button', { name: /^Temperatura/ }));
    await waitFor(() => expect(container.querySelector('.gc-histline')!.textContent)
      .toBe('Temperatura. En 24 h: de 8,8 a 15,1 °C. Ahora 12,3 °C y baja.'));
  });

  it('Cortegada: water, salinity and what else it sends, and no sea it does not measure', async () => {
    const { container } = render(<HistoryDashboard />);
    await waitFor(() => expect(select().value).toBe('mg_14001'));
    fireEvent.change(select(), { target: { value: 'buoy_1250' } });
    await waitFor(() => expect(metricRows(container)).toContain('Salinidad'));
    expect(metricRows(container)).toEqual(['Viento', 'Agua', 'Aire', 'Salinidad', 'Humedad', 'Punto de rocío']);
    // Raw, in full: the hourly aggregates of a buoy keep no salinity
    expect(mocked.fetchBuoyReadings).toHaveBeenLastCalledWith(1250, expect.any(String), expect.any(String), { limit: 10_000 });
    // The service compares stations only
    expect(container.textContent).not.toContain('Comparar');
  });

  // The list arrives and the default pick is still pending as an effect: if the person chooses in that instant, the
  // effect runs after the choice with the old value. It failed one run in ten, on a different test each time.
  it('a choice made the moment the list arrives is not undone by the default pick', async () => {
    const { container } = render(<HistoryDashboard />);
    await new Promise<void>((resolve) => {
      const seen = new MutationObserver(() => {
        if (select().options.length === 0) return;
        seen.disconnect();
        fireEvent.change(select(), { target: { value: 'buoy_1250' } });
        resolve();
      });
      seen.observe(container, { childList: true, subtree: true });
    });
    await waitFor(() => expect(metricRows(container)).toContain('Salinidad'));
    expect(select().value).toBe('buoy_1250');
  });

  it('a request that fails says so in words, not with the message of the request', async () => {
    mocked.fetchReadings.mockRejectedValue(new Error('HTTP 502 Bad Gateway'));
    const { container } = render(<HistoryDashboard />);
    await waitFor(() => expect(container.textContent).toContain('No se pudo cargar el historial'));
    expect(container.textContent).not.toContain('HTTP 502');
  });

  it('a tide gauge opens on its level', async () => {
    const { container } = render(<HistoryDashboard />);
    await waitFor(() => expect(select().value).toBe('mg_14001'));
    fireEvent.change(select(), { target: { value: 'buoy_3223' } });
    await waitFor(() => expect(metricRows(container)[0]).toBe('Nivel del mar'));
    expect(metricRows(container)).not.toContain('Ola');
  });

  it('a station that sent nothing says so, and when it last did', async () => {
    const { container } = render(<HistoryDashboard />);
    await waitFor(() => expect(select().value).toBe('mg_14001'));
    fireEvent.change(select(), { target: { value: 'mg_9' } });
    await waitFor(() => expect(container.textContent).toContain('Sin Antena no ha enviado datos en este periodo.'), { timeout: 5000 });
    expect(container.textContent).toContain('Su última lectura es del 30 oct');
    expect(container.querySelector('.gc-chart')).toBeNull();
  });

  it('an answer that arrives late does not paint over the station now chosen', async () => {
    let answerLate: (rows: never) => void = () => {};
    const { container } = render(<HistoryDashboard />);
    await waitFor(() => expect(select().value).toBe('mg_14001'));
    await waitFor(() => expect(metricRows(container)).toContain('Temperatura'));

    mocked.fetchBuoyReadings.mockImplementationOnce(() => new Promise((res) => { answerLate = res as never; }) as never);
    fireEvent.change(select(), { target: { value: 'buoy_1250' } });
    fireEvent.change(select(), { target: { value: 'mg_9' } });
    await waitFor(() => expect(container.textContent).toContain('Sin Antena no ha enviado datos'));
    answerLate([{ time: isoAgo(5), water_temp: 14 }] as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toContain('Sin Antena no ha enviado datos');
    expect(metricRows(container)).toEqual([]);
  });
});
