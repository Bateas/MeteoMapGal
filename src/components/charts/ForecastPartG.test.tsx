/**
 * The V3 forecast panel: the hour-by-hour table renders, shows only the rows it has data for and
 * keeps humidity and pressure behind «Más datos».
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ForecastHoursG } from './ForecastPartG';
import type { HourlyForecast } from '../../types/forecast';

function hours(n: number, extra: Partial<HourlyForecast> = {}): HourlyForecast[] {
  const start = new Date(); start.setMinutes(0, 0, 0);
  return Array.from({ length: n }, (_, i) => ({
    time: new Date(start.getTime() + i * 3_600_000), temperature: 18, humidity: 70, windSpeed: 5, windDirection: 225,
    windGusts: null, precipitation: 0, precipProbability: 0, cloudCover: 30, pressure: 1018, solarRadiation: 400,
    cape: null, boundaryLayerHeight: null, visibility: null, liftedIndex: null, cin: null, snowLevel: null, skyState: null,
    isDay: true, ...extra,
  }));
}

const rowNames = () => screen.getAllByRole('rowheader').map((h) => h.textContent);

describe('ForecastHoursG', () => {
  it('renders the hours with the rows the model fills, no gust or rain row when there is none', () => {
    render(<ForecastHoursG hourly={hours(6)} />);
    expect(screen.getByRole('region', { name: /desplazable/i })).toBeTruthy();
    expect(rowNames()).toEqual(['Hora', 'Cielo', 'Vientokt', 'Dirección', 'Temp.°C']);
  });

  it('gusts and rain get their row when the model gives them', () => {
    render(<ForecastHoursG hourly={hours(4, { windGusts: 9, precipitation: 0.6 })} />);
    expect(rowNames()).toContain('Rachaskt');
    expect(rowNames()).toContain('Lluviamm');
  });

  it('humidity and pressure only after «Más datos»', () => {
    render(<ForecastHoursG hourly={hours(4)} />);
    expect(rowNames()).not.toContain('Humedad%');
    fireEvent.click(screen.getByRole('button', { name: 'Más datos' }));
    expect(rowNames()).toEqual(expect.arrayContaining(['Humedad%', 'PresiónhPa']));
  });

  it('nothing to draw without forecast hours', () => {
    const { container } = render(<ForecastHoursG hourly={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
