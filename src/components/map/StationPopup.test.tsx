/**
 * What a station card adds to a figure: whether it is recent, where it is going and how it got here.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('react-map-gl/maplibre', () => ({ useMap: () => ({ current: null }) }));
vi.mock('../../services/spotScoringEngine', async (orig) => ({
  ...(await orig<typeof import('../../services/spotScoringEngine')>()),
  isWindBlacklisted: (id: string) => id === 'apartada',
}));

import { StationPopup } from './StationPopup';
import { useWeatherStore } from '../../store/weatherStore';
import { useSpotStore } from '../../store/spotStore';
import { useUIStore } from '../../store/uiStore';
import type { NormalizedReading, NormalizedStation } from '../../types/station';

const MS_PER_KT = 0.514444;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const station = (id = 'mg_1'): NormalizedStation => ({ id, name: 'Remuíño', source: 'meteogalicia', lat: 42.2, lon: -8.1, altitude: 120 } as NormalizedStation);
const reading = (kt: number, ageMin = 5, gustKt?: number): NormalizedReading => ({
  stationId: 'mg_1',
  timestamp: minutesAgo(ageMin),
  windSpeed: kt * MS_PER_KT,
  windGust: gustKt != null ? gustKt * MS_PER_KT : null,
  windDirection: 150,
} as NormalizedReading);

function withHistory(points: NormalizedReading[]) {
  useWeatherStore.setState({ readingHistory: new Map([['mg_1', points]]) });
}

afterEach(() => {
  cleanup();
  useWeatherStore.setState({ readingHistory: new Map() });
  useSpotStore.setState({ scores: new Map() });
});

describe('StationPopup', () => {
  it('says the wind in knots: 10 kt arrive as 5,1 m/s and read 10, never 5', () => {
    render(<StationPopup station={station()} reading={reading(10, 5, 15)} />);
    expect(document.querySelector('.gf-figure')!.textContent).toMatch(/^10\b/);
    expect(document.body.textContent).toContain('racha 15');
  });

  it('has no wind rose', () => {
    render(<StationPopup station={station()} reading={reading(3)} />);
    expect(screen.queryByText('De dónde sopla')).toBeNull();
  });

  it('says when the figure is old instead of showing it as now', () => {
    render(<StationPopup station={station()} reading={reading(3, 120)} />);
    expect(screen.getByText(/Sin datos nuevos: último envío hace 2h/)).toBeTruthy();
    expect(screen.queryByText(/hace 20 min/)).toBeNull();
  });

  it('how recent it is goes at the foot; from half an hour on, up by the name', () => {
    const first = render(<StationPopup station={station()} reading={reading(3, 20)} />);
    expect(first.container.querySelector('.gf-sub:not(.gf-peekonly)')).toBeNull();
    // Folded on a phone the foot is out of view: the head carries the age then, and only then (ficha.css)
    expect(first.container.querySelector('.gf-peekonly')?.textContent).toMatch(/hace 20 min/);
    expect(first.container.querySelector('.gf-credit')?.textContent).toMatch(/hace 20 min/);
    expect(screen.queryByText(/Sin datos nuevos/)).toBeNull();
    first.unmount();
    const second = render(<StationPopup station={station()} reading={reading(3, 45)} />);
    expect(second.container.querySelector('.gf-sub')?.textContent).toMatch(/hace 45 min/);
    expect(screen.queryByText(/Sin datos nuevos/)).toBeNull();
  });

  it('says where the wind is going by the figure, in a word', () => {
    withHistory([reading(3, 110), reading(3, 90), reading(9, 30), reading(11, 10)]);
    render(<StationPopup station={station()} reading={reading(11, 10)} />);
    expect(screen.getByText('sube')).toBeTruthy();
  });

  it('no word about where it goes when the figure is old', () => {
    withHistory([reading(3, 110), reading(3, 90), reading(9, 30), reading(11, 10)]);
    render(<StationPopup station={station()} reading={reading(11, 120)} />);
    expect(screen.queryByText('sube')).toBeNull();
  });

  it('draws the last hours and its peak', () => {
    withHistory([reading(2, 150), reading(3, 120), reading(3, 90, 5), reading(9, 30, 16), reading(10, 20, 14), reading(11, 10, 13)]);
    render(<StationPopup station={station()} reading={reading(11, 10, 13)} />);
    expect(screen.getByText('Últimas 3 horas')).toBeTruthy();
    expect(screen.getByText(/máx\. 16 kt/)).toBeTruthy();
    expect(screen.getByRole('slider', { name: /Racha máxima 16 nudos/ })).toBeTruthy();
    // Same scale as every wind chart: the peak of 16 needs the one that goes up to 20
    expect(screen.getByText('20 kt')).toBeTruthy();
  });

  it('the legend names the thin line only when there are gusts to draw', () => {
    withHistory([reading(2, 150), reading(3, 120), reading(3, 90), reading(9, 30), reading(10, 20), reading(11, 10)]);
    render(<StationPopup station={station()} reading={reading(11, 10)} />);
    expect(screen.getByText('Últimas 3 horas')).toBeTruthy();
    expect(screen.queryByText('línea fina: racha')).toBeNull();
    cleanup();
    withHistory([reading(2, 150), reading(3, 120), reading(3, 90, 5), reading(9, 30, 16), reading(10, 20, 14), reading(11, 10, 13)]);
    render(<StationPopup station={station()} reading={reading(11, 10, 13)} />);
    expect(screen.getByText('línea fina: racha')).toBeTruthy();
  });

  it('no chart with too few readings, or with readings older than the window', () => {
    withHistory([reading(5, 300), reading(5, 290), reading(5, 280), reading(5, 10)]);
    render(<StationPopup station={station()} reading={reading(5, 10)} />);
    expect(screen.queryByText(/Últimas 3 horas/)).toBeNull();
  });

  it('a station set aside says that its wind does not count, without saying why (advanced)', () => {
    useUIStore.setState({ simpleMode: false });
    render(<StationPopup station={station('apartada')} reading={reading(3)} />);
    expect(screen.getByText('Su viento no entra en el cálculo de los spots.')).toBeTruthy();
    useUIStore.setState({ simpleMode: true });
  });

  it('simple mode: no word about how the spots are worked out, nor the altitude; the source stays', () => {
    useUIStore.setState({ simpleMode: true });
    const { container } = render(<StationPopup station={station('apartada')} reading={reading(3)} />);
    expect(container.textContent).not.toContain('cálculo de los spots');
    const credit = container.querySelector('.gf-credit')!.textContent ?? '';
    expect(credit).toContain('MeteoGalicia');
    expect(credit).not.toContain('120 m');
  });

  it('does not list the spots it counts for', () => {
    render(<StationPopup station={station()} reading={reading(3)} />);
    expect(screen.queryByText(/Cuenta para/)).toBeNull();
  });
});
