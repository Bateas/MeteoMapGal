/**
 * Contract tests for the buoy list (17-nov, zone 4 of the plan): the row of the buoy open on the map is the current one,
 * and a tide gauge leads with its level while a platform with a sea leads with the wave, even if it also sends a level.
 * They cover breaks the full sweep of 12-nov left alive in BuoyPanel.tsx. Each was checked to fail with its break.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { BuoyPanel } from './BuoyPanel';
import { useBuoyStore } from '../../store/buoyStore';
import { RIAS_BUOY_STATIONS } from '../../api/buoyClient';
import type { BuoyReading } from '../../api/buoyClient';

const GAUGE = 3221;
const PLATFORM = 1253;
const reading = (id: number, over: Partial<BuoyReading> = {}): BuoyReading => ({
  stationId: id, stationName: RIAS_BUOY_STATIONS.find((s) => s.id === id)!.name, timestamp: new Date().toISOString(),
  waveHeight: null, waveHeightMax: null, wavePeriod: null, wavePeriodMean: null, waveDir: null, windSpeed: 5, windDir: 90,
  windGust: 7, waterTemp: null, airTemp: null, airPressure: null, currentSpeed: null, currentDir: null, salinity: null,
  seaLevel: null, humidity: null, dewPoint: null, ...over,
} as BuoyReading);
const show = (buoys: BuoyReading[], selected: number | null = null) => {
  useBuoyStore.setState({ buoys, error: null, loading: false, lastFetch: Date.now(), selectedBuoyId: selected } as never);
  render(<BuoyPanel />);
  fireEvent.click(screen.getByRole('button', { name: /Boyas marinas/ }));
};
const rowOf = (id: number) => screen.getByText(RIAS_BUOY_STATIONS.find((s) => s.id === id)!.name).closest('button')!;

afterEach(() => {
  cleanup();
  useBuoyStore.setState({ buoys: [], error: null, loading: false, lastFetch: 0, selectedBuoyId: null } as never);
});

describe('the buoy open on the map', () => {
  it('is the current row, and only it', () => {
    show([reading(GAUGE, { seaLevel: 2.6 }), reading(PLATFORM)], PLATFORM);
    expect(rowOf(PLATFORM).getAttribute('aria-current')).toBe('true');
    expect(rowOf(GAUGE).getAttribute('aria-current')).toBeNull();
  });
});

describe('the figure each row leads with', () => {
  it.each([
    ['a tide gauge: its level', GAUGE, { seaLevel: 2.61, waveHeight: 0.02 }, '2,61 m nivel'],
    ['a platform with a sea: the wave, even sending a level', PLATFORM, { waveHeight: 1.2, seaLevel: 2.61 }, '1,2 m ola'],
  ] as const)('%s', (_, id, over, words) => {
    show([reading(id, over)]);
    expect(rowOf(id).querySelector('.gc-rowfig')?.textContent).toBe(words);
  });
});
