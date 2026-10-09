/**
 * The forecast panel scores the hours with the thermal rules of the Embalse (scoreForecastThermal:
 * «the forecast point is the reservoir»). In the Rías those rules scored the Rías forecast and the
 * panel read «51 % 16:00–17:00 W navegable (Embalse)» (9-oct). The windows, the thermometer column
 * and the row tint stay in the Embalse.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ForecastTimeline } from './ForecastTimeline';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { useSectorStore } from '../../store/sectorStore';
import { useThermalStore } from '../../store/thermalStore';
import { SECTORS } from '../../config/sectors';
import type { HourlyForecast } from '../../types/forecast';

const HOUR = 3_600_000;

/** A warm July day with a steady W at 4 m/s: what the Embalse rules call a thermal window. */
function thermalDay(): HourlyForecast[] {
  const start = Math.floor(Date.now() / HOUR) * HOUR;
  // 24 hours from now: whatever the test machine's time zone, 13-21 h local is inside.
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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-15T08:00:00Z'));
  useForecastStore.setState({ hourly: thermalDay(), fetchedAt: new Date(), isLoading: false, error: null });
  useThermalStore.setState({ dailyContext: { tempMax: 31, tempMin: 13, deltaT: 18 } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ForecastTimeline thermal scoring', () => {
  it('in the Embalse the thermal windows and the thermometer column are there (control)', () => {
    setSector('embalse');
    render(<ForecastTimeline />);
    expect(screen.getAllByText(/\(Embalse\)/).length).toBeGreaterThan(0);
    expect(screen.getByTitle('Score térmico estimado')).toBeTruthy();
    expect(screen.getByText(/ΔT hoy/)).toBeTruthy();
  });

  it('in the Rías no Embalse window, no thermometer column, no ΔT and no «scoring térmico»', () => {
    setSector('rias');
    render(<ForecastTimeline />);
    expect(screen.queryByText(/\(Embalse\)/)).toBeNull();
    expect(screen.queryByTitle('Score térmico estimado')).toBeNull();
    expect(screen.queryByText(/ΔT hoy/)).toBeNull();
    expect(screen.queryByText(/scoring térmico/)).toBeNull();
  });
});
