/**
 * Contract tests for the Estaciones list (17-nov, zone 4 of the plan): a station chosen on the map that sits further
 * down opens the whole list, without the button to see more; one near the top leaves the list short, with it. They
 * cover breaks the full sweep of 12-nov left alive in StationTable.tsx. Each was checked to fail with its break.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { StationTable } from './StationTable';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';

const stations = Array.from({ length: 20 }, (_, i) => ({
  id: `mg_${100 + i}`, name: `Estación ${String(i).padStart(2, '0')}`, lat: 42.3, lon: -8.6, source: 'meteogalicia',
}));
const rows = () => document.querySelectorAll('[data-station-row]').length;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  Element.prototype.scrollIntoView = () => {};
  localStorage.removeItem('meteomap_sortMode');
  useWeatherStore.setState({ stations: stations as never, currentReadings: new Map() });
  useWeatherSelectionStore.setState({ selectedStationId: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useWeatherSelectionStore.setState({ selectedStationId: null });
});

describe('a station chosen on the map', () => {
  it('further down: the whole list, no button to see more', () => {
    useWeatherSelectionStore.setState({ selectedStationId: 'mg_118' });
    render(<StationTable />);
    expect(rows()).toBe(20);
    expect(screen.queryByRole('button', { name: /estaciones más/ })).toBeNull();
  });

  it('near the top: the list stays short, with its button', () => {
    useWeatherSelectionStore.setState({ selectedStationId: 'mg_100' });
    render(<StationTable />);
    expect(rows()).toBe(15);
    expect(screen.getByRole('button', { name: 'Ver 5 estaciones más' })).toBeTruthy();
  });
});
