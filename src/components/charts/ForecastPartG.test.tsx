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

describe('direction arrows point where the wind goes (6-oct: they pointed back into the wind)', () => {
  it('head drawn at the top, turned from + 180: N points south, ESE points WNW, W points east', () => {
    const h = hours(3).map((p, i) => ({ ...p, windDirection: [0, 112.5, 270][i] }));
    const { container } = render(<ForecastHoursG hourly={h} />);
    const svgs = [...container.querySelectorAll('svg[data-from]')] as SVGElement[];
    expect(svgs).toHaveLength(3);
    const turn = (s: SVGElement) => Number(/rotate\(([-\d.]+)deg\)/.exec(s.style.transform)![1]);
    for (const s of svgs) {
      // The head is where both barbs start: at the top of the box, i.e. pointing north before the turn,
      // so after turning clockwise by `turn` it points to the compass bearing `turn`.
      expect(s.querySelector('path')!.getAttribute('d')).toMatch(/M12 3l-6 6M12 3l6 6/);
    }
    expect(svgs.map(turn)).toEqual([180, 292.5, 90]);
  });
});
