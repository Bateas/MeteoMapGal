/**
 * The one forecast view: the parte and the hour-by-hour table in both sectors, and the Perfil
 * Atmosférico only in the Embalse and only in advanced mode, folded. The old compact view (thermal
 * windows, thermometer column, ΔT) was cut, so there is no Embalse score left to leak into the Rías.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ForecastTimeline } from './ForecastTimeline';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { useSectorStore } from '../../store/sectorStore';
import { useThermalStore } from '../../store/thermalStore';
import { useUIStore } from '../../store/uiStore';
import { useWarningsStore } from '../../hooks/useWarnings';
import { SECTORS } from '../../config/sectors';
import type { HourlyForecast } from '../../types/forecast';

const HOUR = 3_600_000;

function hours(): HourlyForecast[] {
  const start = Math.floor(Date.now() / HOUR) * HOUR;
  return Array.from({ length: 24 }, (_, i) => ({
    time: new Date(start + (i + 1) * HOUR), temperature: 26, humidity: 50, windSpeed: 4, windDirection: 270,
    windGusts: null, precipitation: 0, precipProbability: 0, cloudCover: 10, pressure: 1020, solarRadiation: 700,
    cape: null, boundaryLayerHeight: null, visibility: null, liftedIndex: null, cin: null, snowLevel: null, skyState: null,
    isDay: true,
  }));
}

function setSector(id: 'rias' | 'embalse') {
  useSectorStore.setState({ activeSectorId: id, activeSector: SECTORS.find((s) => s.id === id)! });
}

beforeEach(() => {
  useForecastStore.setState({ hourly: hours(), fetchedAt: new Date(), isLoading: false, error: null });
  useThermalStore.setState({ atmosphericContext: null });
  useUIStore.setState({ simpleMode: false });
});

describe('ForecastTimeline', () => {
  it('shows the parte and the hour-by-hour table, and says which model and where', () => {
    setSector('rias');
    render(<ForecastTimeline />);
    expect(screen.getByRole('region', { name: /desplazable/i })).toBeTruthy();
    expect(screen.getByText(/Modelo WRF de MeteoGalicia a 1 km en Cesantes/)).toBeTruthy();
  });

  it('has no model selector', () => {
    setSector('rias');
    render(<ForecastTimeline />);
    expect(screen.queryByRole('button', { name: 'WRF-MG' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Auto' })).toBeNull();
  });

  it('in the Embalse, in advanced mode, the Perfil Atmosférico is there and folded', () => {
    setSector('embalse');
    useThermalStore.setState({
      atmosphericContext: { cape: 0, convectiveInhibition: 0, liftedIndex: 12, boundaryLayerHeight: 20, cloudCover: 40, solarRadiation: 0, fetchedAt: new Date() } as never,
    });
    const { container } = render(<ForecastTimeline />);
    const fold = container.querySelector('details.g-fold') as HTMLDetailsElement;
    expect(fold).not.toBeNull();
    expect(fold.open).toBe(false);
    // The title is the conclusion, so it says something without opening it
    expect(fold.querySelector('summary')!.textContent).toMatch(/Perfil atmosférico: estable/);
  });

  it('in simple mode there is no Perfil Atmosférico', () => {
    setSector('embalse');
    useUIStore.setState({ simpleMode: true });
    const { container } = render(<ForecastTimeline />);
    expect(container.querySelector('details.g-fold')).toBeNull();
  });

  it('simple mode shows the wind hour by hour, folds only the table, and opens it on a desktop full screen (18-nov)', () => {
    setSector('rias');
    useUIStore.setState({ simpleMode: true });
    const narrow = render(<ForecastTimeline />);
    const fold = narrow.container.querySelector('details.g-detailfold');
    expect(fold).not.toBeNull();
    // The wind hour by hour is out of the fold: only the table is in it
    expect(fold!.querySelector('[aria-label="El parte"]')).toBeNull();
    expect(narrow.container.querySelector('[aria-label="El parte"]')).not.toBeNull();
    narrow.unmount();
    const { container } = render(<ForecastTimeline wide />);
    expect(container.querySelector('details.g-detailfold')).toBeNull();
    expect(container.querySelector('.g-detailbody--open')).not.toBeNull();
  });

  it('in the Rías there is no Perfil Atmosférico', () => {
    setSector('rias');
    const { container } = render(<ForecastTimeline />);
    expect(container.querySelector('details.g-fold')).toBeNull();
  });
});

describe('a forecast that does not arrive', () => {
  it('says so in words, not with the message of the request', () => {
    setSector('rias');
    useForecastStore.setState({ hourly: [], fetchedAt: null, error: 'HTTP 502 Bad Gateway' } as never);
    const { container } = render(<ForecastTimeline />);
    expect(screen.getByRole('alert').textContent).toContain('No hay previsión ahora. Prueba en un rato.');
    expect(container.textContent).not.toContain('HTTP 502');
    useForecastStore.setState({ error: null } as never);
  });
});

describe('one warning, one line on the screen (Cesantes, 18-nov)', () => {
  it('simple mode: the warning shows with the stretches and not again in the folded parte', () => {
    setSector('rias');
    useUIStore.setState({ simpleMode: true });
    const start = new Date(Date.now() - HOUR), end = new Date(Date.now() + 30 * HOUR);
    useWarningsStore.setState({
      sectorWarnings: [{ type: 'Ondas', typeId: 1, maxLevel: 2, publishedAt: new Date(), link: '',
        zones: [{ name: 'Rías Baixas', id: 1, level: 2, startTime: start, endTime: end, comment: '' }] }],
      ipmaSectorWarnings: [],
    });
    render(<ForecastTimeline />);
    const today = [...document.querySelectorAll('.g-notice')].filter((li) => /oleaje/.test(li.textContent ?? ''));
    // today and tomorrow in the stretches; none inside the fold
    expect(document.querySelectorAll('.g-detailbody .g-notice')).toHaveLength(0);
    expect(today.length).toBeGreaterThan(0);
    useWarningsStore.setState({ sectorWarnings: [], ipmaSectorWarnings: [] });
  });
});
