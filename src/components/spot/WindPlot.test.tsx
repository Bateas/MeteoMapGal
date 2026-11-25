import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WindPlot, type PlotStop } from './WindPlot';
import { windScale } from './windAxis';

afterEach(cleanup);

const H = 3_600_000;
const stops: PlotStop[] = [
  { t: 0, kt: 3, value: '3 kt', note: '10:00, medido' },
  { t: H, kt: 7, value: '7 kt', note: '11:00, medido' },
  { t: 2 * H, kt: 9, value: '9 kt', note: '12:00, modelo' },
];
const plot = (over = {}) => render(
  <WindPlot
    from={0}
    to={2 * H}
    series={[{ points: stops, kind: 'main', gapMs: 2 * H }]}
    stops={stops}
    label="Viento"
    foot={<span>pie</span>}
    {...over}
  />,
);

describe('windScale', () => {
  it('0 and two round figures, the same ladder everywhere', () => {
    expect(windScale(7)).toEqual({ top: 10, ticks: [0, 5, 10] });
    expect(windScale(14)).toEqual({ top: 20, ticks: [0, 10, 20] });
    expect(windScale(27)).toEqual({ top: 30, ticks: [0, 15, 30] });
    expect(windScale(38)).toEqual({ top: 40, ticks: [0, 20, 40] });
  });

  it('a calm day stays low instead of filling the chart', () => {
    expect(windScale(1).top).toBe(10);
    expect(windScale(0).top).toBe(10);
  });

  it('a wild figure still gets a scale', () => {
    expect(windScale(250).top).toBe(100);
  });
});

describe('WindPlot', () => {
  it('says how many knots the top of the chart is', () => {
    plot();
    expect(screen.getByText('10 kt')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('reads nothing until asked', () => {
    const { container } = plot();
    expect(container.querySelector('.gf-plot-tip')).toBeNull();
  });

  it('arrow keys read a point out and name it to a screen reader', () => {
    const { container } = plot();
    const area = screen.getByRole('slider', { name: 'Viento' });
    fireEvent.keyDown(area, { key: 'ArrowLeft' });
    expect(container.querySelector('.gf-plot-tip')!.textContent).toBe('7 kt 11:00, medido');
    expect(area.getAttribute('aria-valuetext')).toBe('7 kt, 11:00, medido');
    fireEvent.keyDown(area, { key: 'Home' });
    expect(container.querySelector('.gf-plot-tip')!.textContent).toBe('3 kt 10:00, medido');
    fireEvent.keyDown(area, { key: 'Escape' });
    expect(container.querySelector('.gf-plot-tip')).toBeNull();
  });

  it('leaving with the mouse clears the reading', () => {
    const { container } = plot();
    const area = screen.getByRole('slider');
    fireEvent.keyDown(area, { key: 'End' });
    expect(container.querySelector('.gf-plot-tip')).not.toBeNull();
    fireEvent.blur(area);
    expect(container.querySelector('.gf-plot-tip')).toBeNull();
  });

  it('with nothing to read, it does not break', () => {
    plot({ stops: [], series: [] });
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowLeft' });
  });
});
