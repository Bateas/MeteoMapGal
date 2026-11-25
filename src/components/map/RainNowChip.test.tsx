import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RainNowChip } from './RainNowChip';
import { useRainNowStore, type RainNowSummary } from '../../store/rainNowStore';

describe('RainNowChip', () => {
  beforeEach(() => {
    useRainNowStore.setState({
      summary: {
        arrivals: [],
        approaching: [{ distanceKm: 30, fromDeg: 225, kmh: 42, etaMin: 40 }],
        gauges: [],
        motion: { toDeg: 45, kmh: 30 },
        radarAgeMin: 5,
      },
      checks: [],
    } as never);
  });

  it('names a direction the way the rest of the map does', () => {
    render(<RainNowChip />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog').textContent).toContain('al SW:');
    expect(screen.getByRole('dialog').textContent).not.toMatch(/\bSO\b/);
  });
});

const summary = (over: Partial<RainNowSummary> = {}): RainNowSummary => ({
  gauges: [], arrivals: [{ spotId: 'castrelo', spotName: 'Castrelo', etaMin: 0, distanceKm: 0 }],
  approaching: [{ fromDeg: 225, distanceKm: 100, kmh: 60, toDeg: 45, etaMin: 55 }],
  motion: null, radarAgeMin: 4, cells: 3, sim: false, ...over,
});

afterEach(() => { cleanup(); useRainNowStore.setState({ summary: null }); });

describe('the rain legend (18-nov, a curious user)', () => {
  it('already raining here, the next patch is «más lluvia», not the start of it', () => {
    useRainNowStore.setState({ summary: summary() });
    render(<RainNowChip />);
    fireEvent.click(screen.getByRole('button', { name: /Llueve/ }));
    expect(screen.getByText(/Más lluvia a 100 km al SW/)).toBeTruthy();
  });

  it('dry here, it is just «lluvia»', () => {
    useRainNowStore.setState({ summary: summary({ arrivals: [] }) });
    render(<RainNowChip />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/^Lluvia a 100 km al SW/)).toBeTruthy();
  });

  it('the method is folded and Escape closes it', () => {
    useRainNowStore.setState({ summary: summary() });
    render(<RainNowChip />);
    fireEvent.click(screen.getByRole('button', { name: /Llueve/ }));
    const how = screen.getByText('Cómo se dibuja').closest('details') as HTMLDetailsElement;
    expect(how.open).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Lluvia ahora' })).toBeNull();
  });
});
