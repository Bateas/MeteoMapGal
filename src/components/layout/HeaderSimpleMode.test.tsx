import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * Simple mode is a new visitor's first screen. On desktop the header used to
 * show the per-source strip (A MG MC WU NT...) and the readings count there too,
 * the jargon the map already hides; and the toggle was an aria-pressed switch
 * that read "Avanzado, activado" while simple mode was the active one.
 */
vi.mock('../common/SourceStatusIndicator', () => ({
  SourceStatusIndicator: () => <span data-testid="source-strip">A MG MC WU NT</span>,
}));

import { Header } from './Header';
import { useUIStore } from '../../store/uiStore';
import { useWeatherStore } from '../../store/weatherStore';

function setup(simpleMode: boolean) {
  cleanup();
  useUIStore.setState({ isMobile: false, simpleMode } as never);
  useWeatherStore.setState({
    stations: [{ id: 'a' }, { id: 'b' }] as never,
    currentReadings: new Map([['a', {}]]) as never,
  } as never);
  render(<Header onRefresh={() => {}} />);
}

describe('desktop header in simple mode', () => {
  beforeEach(() => localStorage.clear());

  it('hides the source strip and the readings count', () => {
    setup(true);
    expect(screen.queryByTestId('source-strip')).toBeNull();
    expect(screen.queryByText('1/2')).toBeNull();
  });

  it('advanced mode still shows them', () => {
    setup(false);
    expect(screen.getByTestId('source-strip')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
  });

  it('the toggle is an action that says where it goes, with no pressed state', () => {
    setup(true);
    const btn = screen.getByRole('button', { name: 'Pasar a modo avanzado' });
    expect(btn.hasAttribute('aria-pressed')).toBe(false);
    setup(false);
    expect(screen.getByRole('button', { name: 'Pasar a modo simple' }).hasAttribute('aria-pressed')).toBe(false);
  });
});
