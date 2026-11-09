import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PointForecast, __clearPointForecastCacheForTests } from './PointForecast';
import { fetchMeteoSixForecast } from '../../api/meteoSixClient';
import { fetchMGWarnings, type MGWarning } from '../../api/mgWarningsClient';
import { fetchMeteoPointStatus } from '../../api/meteoPointStatusClient';

vi.mock('../../api/meteoSixClient', () => ({ fetchMeteoSixForecast: vi.fn() }));
vi.mock('../../api/mgWarningsClient', () => ({ fetchMGWarnings: vi.fn() }));
vi.mock('../../api/meteoPointStatusClient', () => ({ fetchMeteoPointStatus: vi.fn() }));

const tomorrow9 = new Date(Date.now() + 86_400_000);
tomorrow9.setHours(9, 0, 0, 0);
const rainyHour = { time: tomorrow9, temperature: 14, humidity: 90, windSpeed: 5, windDirection: 180, precipitation: 4.9 };
const zones = ['Zona A'];

beforeEach(() => {
  __clearPointForecastCacheForTests();
  vi.mocked(fetchMGWarnings).mockResolvedValue([]);
  vi.mocked(fetchMeteoPointStatus).mockResolvedValue(null);
});

describe('PointForecast', () => {
  it('says roughly when it rains next and draws the hours', async () => {
    vi.mocked(fetchMeteoSixForecast).mockResolvedValue([rainyHour] as never);
    const { container } = render(<PointForecast pointId="p" lat={42.2} lon={-8.2} zones={zones} />);
    await waitFor(() => expect(screen.getByText(/4,9 mm en 1 h/)).toBeTruthy());
    expect(container.querySelector('.gfp-chart')).toBeTruthy();
    expect(fetchMeteoSixForecast).toHaveBeenCalledWith(42.2, -8.2);
  });

  it('shows how the rain goes against the WRF, and leaves it out when the server has nothing', async () => {
    vi.mocked(fetchMeteoSixForecast).mockResolvedValue([rainyHour] as never);
    vi.mocked(fetchMeteoPointStatus).mockResolvedValue({ state: 'no-llega', text: 'El WRF daba lluvia a las 8 h.' });
    const first = render(<PointForecast pointId="p" lat={42.2} lon={-8.2} zones={zones} />);
    await waitFor(() => expect(screen.getByText(/El WRF daba lluvia a las 8 h/)).toBeTruthy());
    expect(fetchMeteoPointStatus).toHaveBeenCalledWith('p');
    first.unmount();
    vi.mocked(fetchMeteoPointStatus).mockResolvedValue(null);
    render(<PointForecast pointId="p" lat={42.2} lon={-8.2} zones={zones} />);
    await waitFor(() => expect(screen.getByText(/4,9 mm en 1 h/)).toBeTruthy());
    expect(screen.queryByText(/frente al WRF/)).toBeNull();
  });

  it('says so when the model does not answer, without breaking the card', async () => {
    vi.mocked(fetchMeteoSixForecast).mockRejectedValue(new Error('caido'));
    render(<PointForecast pointId="p" lat={42.2} lon={-8.2} zones={zones} />);
    await waitFor(() => expect(screen.getByText(/Sin previsión ahora mismo/)).toBeTruthy());
  });

  it('asks the model once for the same point', async () => {
    vi.mocked(fetchMeteoSixForecast).mockClear();
    vi.mocked(fetchMeteoSixForecast).mockResolvedValue([] as never);
    const { unmount } = render(<PointForecast pointId="p" lat={42.2} lon={-8.2} zones={zones} />);
    await waitFor(() => expect(screen.getByText(/no llega/)).toBeTruthy());
    unmount();
    render(<PointForecast pointId="p" lat={42.2} lon={-8.2} zones={zones} />);
    await waitFor(() => expect(screen.getByText(/no llega/)).toBeTruthy());
    expect(fetchMeteoSixForecast).toHaveBeenCalledTimes(1);
  });

  it('shows the warnings of its own zone and not those of the neighbours', async () => {
    const soon = new Date(Date.now() + 3_600_000);
    const later = new Date(Date.now() + 7_200_000);
    const zone = (name: string, comment: string) => ({ name, id: 1, level: 1, startTime: soon, endTime: later, comment });
    vi.mocked(fetchMeteoSixForecast).mockResolvedValue([rainyHour] as never);
    vi.mocked(fetchMGWarnings).mockResolvedValue([{
      type: 'Refacho', typeId: 7, maxLevel: 1, publishedAt: new Date(), link: '',
      zones: [zone('Zona A', 'de aqui'), zone('Zona B', 'de al lado')],
    } as MGWarning]);
    render(<PointForecast pointId="p" lat={42.2} lon={-8.2} zones={zones} />);
    await waitFor(() => expect(screen.getByText(/de aqui/)).toBeTruthy());
    expect(screen.queryByText(/de al lado/)).toBeNull();
  });

  it('says there are none only once the list has arrived', async () => {
    vi.mocked(fetchMeteoSixForecast).mockResolvedValue([rainyHour] as never);
    render(<PointForecast pointId="p" lat={42.2} lon={-8.2} zones={zones} />);
    expect(screen.queryByText(/Sin avisos/)).toBeNull();
    await waitFor(() => expect(screen.getByText('Sin avisos oficiales en Zona A.')).toBeTruthy());
  });

  it('claims nothing about warnings when the list fails', async () => {
    vi.mocked(fetchMeteoSixForecast).mockResolvedValue([rainyHour] as never);
    vi.mocked(fetchMGWarnings).mockRejectedValue(new Error('caido'));
    render(<PointForecast pointId="p" lat={42.2} lon={-8.2} zones={zones} />);
    await waitFor(() => expect(screen.getByText(/4,9 mm en 1 h/)).toBeTruthy());
    expect(screen.queryByText(/Sin avisos/)).toBeNull();
  });
});
