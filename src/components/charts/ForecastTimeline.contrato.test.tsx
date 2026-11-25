/**
 * Contract tests for the forecast tab (17-nov, zone 4 of the plan): a spot whose own forecast fails says so, falls
 * back to the zone's when there is one and only then; the time it names is the one of the forecast shown; the thermal
 * line is only the reservoir's. They cover breaks the full sweep of 12-nov left alive in ForecastTimeline.tsx.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

const h = vi.hoisted(() => ({ fail: false }));
vi.mock('../../api/meteoSixClient', async (orig) => ({
  ...(await orig<typeof import('../../api/meteoSixClient')>()),
  fetchMeteoSixForecast: vi.fn(async () => { if (h.fail) throw new Error('down'); return hours(); }),
}));
vi.mock('../../services/thermalForecastDetector', async (orig) => ({
  ...(await orig<typeof import('../../services/thermalForecastDetector')>()),
  detectThermalForecast: () => [{ label: 'Mañana, día de térmica probable', confidence: 'media' }],
}));

import { ForecastTimeline } from './ForecastTimeline';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { useSectorStore } from '../../store/sectorStore';
import { useThermalStore } from '../../store/thermalStore';
import { useUIStore } from '../../store/uiStore';
import { SECTORS } from '../../config/sectors';

const sector = (id: 'rias' | 'embalse') => useSectorStore.setState({ activeSectorId: id, activeSector: SECTORS.find((s) => s.id === id)! });
const SECTOR_TIME = new Date(2026, 6, 15, 6, 7);

beforeEach(() => {
  h.fail = false;
  sector('rias');
  useForecastStore.setState({ hourly: [], fetchedAt: null, isLoading: false, error: null });
  useThermalStore.setState({ atmosphericContext: null });
  useUIStore.setState({ simpleMode: false });
});
afterEach(cleanup);

describe('a spot whose own forecast fails', () => {
  it('without the zone one either, says there is none now', async () => {
    h.fail = true;
    render(<ForecastTimeline spotCoords={{ lat: 42.29, lon: -8.6 }} />);
    expect(await screen.findByText(/No hay previsión ahora/)).toBeTruthy();
  });

  it('with the zone one, shows it and says it is the zone one', async () => {
    h.fail = true;
    useForecastStore.setState({ hourly: hours(), fetchedAt: SECTOR_TIME });
    render(<ForecastTimeline spotCoords={{ lat: 42.29, lon: -8.6 }} />);
    expect(await screen.findByText(/No hay previsión propia de este spot ahora/)).toBeTruthy();
    expect(screen.queryByText(/No hay previsión ahora/)).toBeNull();
    // And the time it names is the zone forecast's, the one on screen
    expect(document.body.textContent).toContain('descargado a las 06:07');
  });

  it('a spot that has its own never says it fell back to the zone', async () => {
    useForecastStore.setState({ hourly: hours(), fetchedAt: SECTOR_TIME });
    render(<ForecastTimeline spotCoords={{ lat: 42.29, lon: -8.6 }} />);
    await screen.findByRole('region', { name: /desplazable/i });
    expect(screen.queryByText(/No hay previsión propia/)).toBeNull();
  });
});

describe('the time it was downloaded', () => {
  it('is the one of the zone forecast when it is the zone one on screen', () => {
    useForecastStore.setState({ hourly: hours(), fetchedAt: SECTOR_TIME });
    render(<ForecastTimeline />);
    expect(document.body.textContent).toContain('descargado a las 06:07');
  });
});

describe('the thermal line', () => {
  it('is said in the reservoir and not on the coast', () => {
    useForecastStore.setState({ hourly: hours(), fetchedAt: SECTOR_TIME });
    sector('embalse');
    render(<ForecastTimeline />);
    expect(document.body.textContent).toContain('día de térmica probable');
    cleanup();
    sector('rias');
    render(<ForecastTimeline />);
    expect(document.body.textContent).not.toContain('día de térmica probable');
  });
});
