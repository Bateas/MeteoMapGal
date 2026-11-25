/**
 * Random break of 12-nov that went through with the whole suite green: a station chosen on the map no longer came
 * into view in the Estaciones list. Checked to fail with that break.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { StationTable } from './StationTable';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';

const stations = Array.from({ length: 20 }, (_, i) => ({
  id: `mg_${100 + i}`, name: `Estación ${String(i).padStart(2, '0')}`, lat: 42.3, lon: -8.6, source: 'meteogalicia',
}));

let scrolled: string[] = [];

beforeEach(() => {
  scrolled = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.getAttribute('data-station-row') ?? ''); };
  useWeatherStore.setState({ stations: stations as never, currentReadings: new Map() });
  useWeatherSelectionStore.setState({ selectedStationId: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useWeatherSelectionStore.setState({ selectedStationId: null });
});

describe('a station chosen on the map', () => {
  it('comes into view in the list', () => {
    useWeatherSelectionStore.setState({ selectedStationId: 'mg_118' });
    render(<StationTable />);
    expect(scrolled).toEqual(['mg_118']);
  });

  it('with none chosen, the list does not move', () => {
    render(<StationTable />);
    expect(scrolled).toEqual([]);
  });
});

describe('the order of the list', () => {
  it('keeps the one chosen last time', () => {
    localStorage.setItem('meteomap_sortMode', 'temp');
    try {
      render(<StationTable />);
      expect(document.querySelector('button[aria-pressed="true"]')!.textContent).toBe('Temperatura');
    } finally {
      localStorage.removeItem('meteomap_sortMode');
    }
  });
});
