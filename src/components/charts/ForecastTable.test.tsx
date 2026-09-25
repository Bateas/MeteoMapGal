/**
 * ForecastTable accessibility: header cells and keyboard access to the scroller.
 *
 * - The top-left corner of the day row was an empty <th>: a header with no
 *   text, announced as a blank column header. It heads nothing, so it is a <td>.
 * - The table scrolls sideways but has no focusable cells, so keyboard users
 *   could not reach it to scroll. The region itself takes focus.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ForecastTable } from './ForecastTable';
import { useThermalStore } from '../../store/thermalStore';
import type { HourlyForecast } from '../../types/forecast';

function hour(time: Date, overrides: Partial<HourlyForecast> = {}): HourlyForecast {
  return {
    time,
    temperature: 18,
    humidity: 70,
    windSpeed: 5,
    windDirection: 270,
    windGusts: 7,
    precipitation: 0,
    precipProbability: 10,
    cloudCover: 30,
    pressure: 1015,
    solarRadiation: 400,
    cape: 0,
    boundaryLayerHeight: 800,
    visibility: 20000,
    liftedIndex: 2,
    cin: 0,
    snowLevel: null,
    skyState: null,
    isDay: true,
    ...overrides,
  };
}

// Two days so the day header row has more than one group.
const DATA: HourlyForecast[] = [
  hour(new Date(2026, 8, 26, 22)),
  hour(new Date(2026, 8, 26, 23), { isDay: false }),
  hour(new Date(2026, 8, 27, 0), { isDay: false }),
];

beforeEach(() => {
  useThermalStore.setState({ rules: [] });
});

describe('ForecastTable accessibility', () => {
  it('has no empty header cells', () => {
    const { container } = render(<ForecastTable data={DATA} />);
    const headers = Array.from(container.querySelectorAll('th'));
    expect(headers.length).toBeGreaterThan(0);
    const empty = headers.filter(
      (th) => th.textContent!.trim() === '' && !th.getAttribute('aria-label'),
    );
    expect(empty).toHaveLength(0);
  });

  it('the scrollable region can be reached with the keyboard', () => {
    render(<ForecastTable data={DATA} />);
    const region = screen.getByRole('region', { name: /Tabla de prevision/ });
    expect(region.tabIndex).toBe(0);
    region.focus();
    expect(document.activeElement).toBe(region);
  });

  it('keeps the focus ring outside the scroller, with room for it', () => {
    // Inset, the sticky first column paints over the ring; outside with no
    // margin, the overflow-hidden parent clips it. The ring is 2px wide.
    render(<ForecastTable data={DATA} />);
    const region = screen.getByRole('region', { name: /Tabla de prevision/ });
    const offset = parseFloat(region.style.outlineOffset);
    const margin = parseFloat(region.style.margin);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(margin).toBeGreaterThanOrEqual(offset + 2);
  });
});
