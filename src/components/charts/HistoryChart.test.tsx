import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoryChart } from './HistoryChart';
import { STATION_METRICS } from '../../services/historySeries';

const humidity = STATION_METRICS.find((m) => m.key === 'humidity')!;
const H = 3_600_000;
const from = Date.UTC(2026, 10, 18, 8);
const series = [0, 1, 2, 3].map((i) => ({ t: from + i * H, v: 60 + i * 5 }));
const formatTime = (t: number) => `${new Date(t).getUTCHours()} h`;

function draw() {
  render(
    <HistoryChart series={series} metric={humidity} fromMs={from} toMs={from + 3 * H} label="Humedad de hoy" formatTime={formatTime} />,
  );
  return screen.getByRole('slider', { name: 'Humedad de hoy' });
}

describe('HistoryChart from the keyboard (P3 review, 19-nov)', () => {
  it('is a focusable slider that the arrows walk reading by reading', () => {
    const chart = draw();
    expect(chart.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(chart, { key: 'End' });
    expect(chart.getAttribute('aria-valuenow')).toBe('3');
    expect(chart.getAttribute('aria-valuetext')).toBe('11 h: 75 %');
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(chart.getAttribute('aria-valuetext')).toBe('10 h: 70 %');
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(chart.getAttribute('aria-valuetext')).toBe('8 h: 60 %');
    expect(screen.getByText('8 h: 60 %')).toBeTruthy();
  });

  it('the first Escape drops the reading and keeps the panel open; the next one goes through', () => {
    const chart = draw();
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    let reached = 0;
    const count = () => { reached += 1; };
    document.addEventListener('keydown', count);
    try {
      fireEvent.keyDown(chart, { key: 'Escape' });
      expect(reached).toBe(0);
      expect(chart.getAttribute('aria-valuetext')).toBe('Flechas para leer las medidas');
      fireEvent.keyDown(chart, { key: 'Escape' });
      expect(reached).toBe(1);
    } finally {
      document.removeEventListener('keydown', count);
    }
  });
});
