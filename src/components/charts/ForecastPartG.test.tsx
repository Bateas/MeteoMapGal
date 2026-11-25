/**
 * The V3 forecast panel: the hour-by-hour table renders, shows only the rows it has data for and
 * keeps humidity and pressure behind «Más datos».
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ForecastHoursG, ForecastPartG } from './ForecastPartG';
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

  it('«Más datos» writes the bearing under each arrow', () => {
    const h = hours(3).map((p, i) => ({ ...p, windDirection: [0, 112.4, 359.6][i] }));
    const { container } = render(<ForecastHoursG hourly={h} />);
    expect(container.querySelectorAll('.g-deg')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Más datos' }));
    expect([...container.querySelectorAll('.g-deg')].map((e) => e.textContent)).toEqual(['0', '112', '0']);
    expect(rowNames()).toContain('Dirección°');
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

describe('the day strips: «ahora» is an hour of today', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('one cell says «ahora», in the strip of today, and tomorrow at the same hour shows its hour', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 15, 13, 0, 0));
    render(<ForecastPartG hourly={hours(40)} />);
    const today = screen.getByRole('list', { name: 'Horas de luz, hoy' });
    const tomorrow = screen.getByRole('list', { name: 'Horas de luz, mañana' });
    expect(screen.getAllByText('ahora')).toHaveLength(1);
    expect(within(today).getByText('ahora')).toBeTruthy();
    expect(within(tomorrow).queryByText('ahora')).toBeNull();
    expect(within(tomorrow).getByText('13')).toBeTruthy();
  });
});

describe('ForecastSimpleG: simple mode answers rain, wind and cold first', () => {
  it('one row per stretch, each figure with its unit, and nothing by the hour', async () => {
    const { ForecastSimpleG } = await import('./ForecastPartG');
    const { render: r } = await import('@testing-library/react');
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const hourly = Array.from({ length: 72 }, (_, h) => ({
      time: new Date(start.getTime() + h * 3_600_000), temperature: 12, humidity: 80, windSpeed: 4, windDirection: 200,
      windGusts: null, precipitation: h % 24 === 15 ? 3 : 0, precipProbability: null, cloudCover: 40, pressure: null, skyState: null,
    })) as never;
    const { container } = r(<ForecastSimpleG hourly={hourly} />);
    const rows = [...container.querySelectorAll('.g-bandday > ul:not(.g-notices) > li')];
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row.querySelector('.g-bandwind')!.textContent).toMatch(/^\d+ kt$/);
      expect(row.querySelector('.g-bandrain')!.textContent).toMatch(/^(Sin lluvia|\d+(,\d)? mm)$/);
      expect(row.getAttribute('aria-label')).toMatch(/viento hasta \d+ nudos/);
    }
    expect(container.querySelector('table')).toBeNull();
  });
});

describe('the day heading read aloud (P4, 18-nov)', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('the day and its sun hours are two phrases, not «Mañanasol de 8:27»', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 22, 0, 0));
    const { ForecastSimpleG } = await import('./ForecastPartG');
    const start = new Date(2026, 10, 18, 0, 0, 0);
    const hourly = Array.from({ length: 72 }, (_, h) => ({
      time: new Date(start.getTime() + h * 3_600_000), temperature: 12, humidity: 80, windSpeed: 4, windDirection: 200,
      windGusts: null, precipitation: 0, precipProbability: null, cloudCover: 40, pressure: null, skyState: null,
    })) as never;
    render(<ForecastSimpleG hourly={hourly} />);
    const heading = screen.getByRole('heading', { name: /^Mañana/ });
    expect(heading.textContent).toMatch(/^Mañana, sol de \d{1,2}:\d{2} a \d{1,2}:\d{2}$/);
  });
});
