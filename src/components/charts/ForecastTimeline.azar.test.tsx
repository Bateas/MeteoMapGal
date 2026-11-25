/**
 * Random break of 12-nov that went through with the whole suite green: a spot whose own forecast was on its way said
 * «No hay previsión ahora» when the sector's forecast was not loaded. Checked to fail with that break.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { HourlyForecast } from '../../types/forecast';

const HOUR = 3_600_000;
function hours(): HourlyForecast[] {
  const start = Math.floor(Date.now() / HOUR) * HOUR;
  return Array.from({ length: 24 }, (_, i) => ({
    time: new Date(start + (i + 1) * HOUR), temperature: 26, humidity: 50, windSpeed: 4, windDirection: 270,
    windGusts: null, precipitation: 0, precipProbability: 0, cloudCover: 10, pressure: 1020, solarRadiation: 700,
    cape: null, boundaryLayerHeight: null, visibility: null, liftedIndex: null, cin: null, snowLevel: null, skyState: null,
    isDay: true,
  })) as HourlyForecast[];
}

const h = vi.hoisted(() => ({ wait: false, empty: false }));
vi.mock('../../api/meteoSixClient', async (orig) => ({
  ...(await orig<typeof import('../../api/meteoSixClient')>()),
  fetchMeteoSixForecast: vi.fn(async () => (h.wait ? new Promise<never>(() => {}) : h.empty ? [] : hours())),
}));

import { ForecastTimeline } from './ForecastTimeline';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { useSectorStore } from '../../store/sectorStore';
import { useThermalStore } from '../../store/thermalStore';
import { useUIStore } from '../../store/uiStore';
import { SECTORS } from '../../config/sectors';

beforeEach(() => {
  h.wait = false;
  h.empty = false;
  useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! });
  useForecastStore.setState({ hourly: [], fetchedAt: null, isLoading: false, error: null });
  useThermalStore.setState({ atmosphericContext: null });
  useUIStore.setState({ simpleMode: false });
});

describe('a spot with its own forecast', () => {
  it('shows it, and says nothing about a missing forecast, while the sector one is not loaded', async () => {
    render(<ForecastTimeline spotCoords={{ lat: 42.29, lon: -8.6 }} />);
    expect(await screen.findByRole('region', { name: /desplazable/i })).toBeTruthy();
    expect(screen.queryByText(/No hay previsión ahora/)).toBeNull();
  });

  it('while it is on its way, it does not say there is none', () => {
    h.wait = true;
    render(<ForecastTimeline spotCoords={{ lat: 42.29, lon: -8.6 }} />);
    expect(screen.queryByText(/No hay previsión ahora/)).toBeNull();
  });

  it('when it comes back empty, the sector forecast is shown and said so', async () => {
    h.empty = true;
    useForecastStore.setState({ hourly: hours(), fetchedAt: new Date(), isLoading: false, error: null });
    render(<ForecastTimeline spotCoords={{ lat: 42.29, lon: -8.6 }} />);
    expect(await screen.findByText(/No hay previsión propia de este spot ahora/)).toBeTruthy();
    expect(screen.getByRole('region', { name: /desplazable/i })).toBeTruthy();
  });
});
