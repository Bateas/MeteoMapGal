/**
 * Contract tests for the forecast panel (17-nov, zone 4 of the plan): what each hour says to a screen reader, the
 * gusts marked from 25 kt, the line that explains what is under each hour, no empty warning list and the day headers
 * of the hour-by-hour table. They cover breaks the full sweep of 12-nov left alive in ForecastPartG.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ForecastHoursG, ForecastPartG } from './ForecastPartG';
import type { HourlyForecast } from '../../types/forecast';
import { useWarningsStore } from '../../hooks/useWarnings';
import type { IpmaWarning } from '../../api/ipmaWarningsClient';

const HOUR = 3_600_000;
const MS = 0.514444;
// Ten in the morning, local: the day strips are the hours of light
const NOW = new Date(2026, 6, 15, 10, 0, 0);

function hours(n: number, extra: (i: number) => Partial<HourlyForecast> = () => ({})): HourlyForecast[] {
  return Array.from({ length: n }, (_, i) => ({
    time: new Date(NOW.getTime() + i * HOUR), temperature: 18, humidity: 70, windSpeed: 10 * MS, windDirection: 225,
    windGusts: null, precipitation: 0, precipProbability: 0, cloudCover: 30, pressure: 1018, solarRadiation: 400,
    cape: null, boundaryLayerHeight: null, visibility: null, liftedIndex: null, cin: null, snowLevel: null, skyState: null,
    isDay: true, ...extra(i),
  }));
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const cellOf = (hour: number) => [...document.querySelectorAll('.g-strip li')].find((li) => li.getAttribute('aria-label')?.startsWith(`${hour} h:`))!;

describe('what each hour of the day says', () => {
  it.each([
    [0.6, ', 0,6 mm de lluvia'],
    [0.05, null],
  ] as const)('%s mm of rain', (mm, words) => {
    render(<ForecastPartG hourly={hours(8, (i) => (i === 2 ? { precipitation: mm } : {}))} />);
    const label = cellOf(12).getAttribute('aria-label')!;
    if (words) expect(label).toContain(words);
    else expect(label).not.toContain('lluvia');
  });

  it('a gust of 25 kt or more is marked, a smaller one is not', () => {
    render(<ForecastPartG hourly={hours(8, (i) => ({ windGusts: (i === 2 ? 25 : 18) * MS + 0.001 }))} />);
    expect(cellOf(12).querySelector('.g-gust')?.className).toContain('warn');
    expect(cellOf(11).querySelector('.g-gust')?.className).not.toContain('warn');
  });
});

describe('what the parte does not say', () => {
  it('no legend, no notes: each cell prints its knots (18-nov)', () => {
    render(<ForecastPartG hourly={hours(8, (i) => (i === 1 ? { precipitation: 0.4 } : {}))} />);
    expect(document.querySelector('.g-legend')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Bajo cada hora|horas de luz · nudos|Es el modelo/);
  });
  it('the gust mark is explained only when some hour carries it', () => {
    render(<ForecastPartG hourly={hours(8, (i) => ({ windGusts: (i === 2 ? 26 : 15) * MS }))} />);
    expect(document.querySelector('.g-under')?.textContent).toBe('Racha marcada: 25 kt o más.');
    cleanup();
    render(<ForecastPartG hourly={hours(8, () => ({ windGusts: 15 * MS }))} />);
    expect(document.querySelector('.g-under')).toBeNull();
  });
});

describe('a quiet day', () => {
  it('has no empty list of warnings', () => {
    render(<ForecastPartG hourly={hours(8)} />);
    expect(document.querySelector('.g-notices')).toBeNull();
  });
});

describe('a spot hears only the warnings that reach it', () => {
  const viana: IpmaWarning = {
    id: 'v', districtCode: 'VCT', districtName: 'Viana do Castelo', type: 'Precipitação', level: 1, levelName: 'yellow',
    startTime: new Date(NOW.getTime() - HOUR), endTime: new Date(NOW.getTime() + 6 * HOUR), description: '',
  };
  afterEach(() => useWarningsStore.setState({ sectorWarnings: [], ipmaSectorWarnings: [] }));

  it('the Cesantes forecast does not carry the rain warning of Viana do Castelo (18-nov); the sector one does', () => {
    useWarningsStore.setState({ sectorWarnings: [], ipmaSectorWarnings: [viana] });
    render(<ForecastPartG hourly={hours(8)} place={{ lat: 42.307, lon: -8.619 }} />);
    expect(document.body.textContent).not.toContain('(IPMA)');
    cleanup();
    render(<ForecastPartG hourly={hours(8)} />);
    expect(document.body.textContent).toContain('(IPMA)');
  });
});

describe('the day headers of the hour-by-hour table', () => {
  it('one header per day, spanning its hours, and the first hour of each new day starts a column group', () => {
    render(<ForecastHoursG hourly={hours(30)} />);
    const heads = [...document.querySelectorAll('th.g-dayh')] as HTMLTableCellElement[];
    expect(heads).toHaveLength(2);
    expect(heads.map((h) => h.colSpan)).toEqual([14, 16]);
    const hourCells = [...document.querySelectorAll('th.g-hh')];
    expect(hourCells.filter((c) => c.className.includes('g-dstart'))).toHaveLength(1);
    expect(hourCells[14].className).toContain('g-dstart');
    expect(hourCells[0].className).toContain('g-nowcol');
    expect(hourCells[1].className).not.toContain('g-nowcol');
  });
});
