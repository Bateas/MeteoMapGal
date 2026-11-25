/**
 * Contract tests for what a buoy card says, in tables (17-nov, zone 2 of the plan): how old the reading is, the line
 * under the big figure, the cold water, the figures for whoever asks for more and the sea level of a tide gauge.
 * They cover breaks the full sweep of 12-nov left alive in BuoyPopup.tsx. Each was checked to fail with its break.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('react-map-gl/maplibre', () => ({ useMap: () => ({ current: null }) }));

import { BuoyPopup } from './BuoyPopup';
import { RIAS_BUOY_STATIONS } from '../../api/buoyClient';
import type { BuoyReading } from '../../api/buoyClient';
import { useUIStore } from '../../store/uiStore';

const GAUGE = 3221;   // tide gauge (REDMAR): measures the dock, not the sea
const PLATFORM = 1253;
const station = (id: number) => RIAS_BUOY_STATIONS.find((s) => s.id === id)!;
const reading = (id: number, over: Partial<BuoyReading> = {}): BuoyReading => ({
  stationId: id, stationName: station(id).name, timestamp: new Date(), waveHeight: null, waveHeightMax: null, wavePeriod: null,
  wavePeriodMean: null, waveDir: null, windSpeed: 5, windDir: 90, windGust: 7, waterTemp: null,
  airTemp: null, airPressure: null, currentSpeed: null, currentDir: null, salinity: null, seaLevel: null,
  humidity: null, dewPoint: null, ...over,
} as BuoyReading);
const dd = (label: string) => [...document.querySelectorAll('dt')].find((d) => d.textContent === label)?.nextElementSibling?.textContent;
const sub = () => document.querySelector('.gf-head .gf-sub')?.textContent ?? '';
const ago = (min: number) => new Date(Date.now() - min * 60_000) as unknown as string;

beforeEach(() => useUIStore.setState({ simpleMode: false }));
afterEach(() => { cleanup(); useUIStore.setState({ simpleMode: false }); });

describe('how old the reading is', () => {
  it.each([[30, 'hace 30 min'], [180, 'hace 3 h'], [30 * 60, 'hace 1 d']] as const)('%s min', (min, words) => {
    render(<BuoyPopup reading={reading(PLATFORM, { timestamp: ago(min) })} />);
    expect(sub()).toBe(`Boya · ${words}`);
  });
});

describe('the line under the big figure', () => {
  it('a sea with a heading says where it comes from', () => {
    render(<BuoyPopup reading={reading(PLATFORM, { waveHeight: 1.4, waveDir: 315 })} />);
    expect([...document.querySelectorAll('.gf-side span')].map((s) => s.textContent)).toEqual(['del NW 315°']);
  });

  it('a sea without a heading has no line at all', () => {
    render(<BuoyPopup reading={reading(PLATFORM, { waveHeight: 1.4 })} />);
    expect(document.querySelectorAll('.gf-side span')).toHaveLength(0);
  });
});

describe('the water', () => {
  it.each([[10, '10,0 °C muy fría para la zona Atención'], [14, '14,0 °C']] as const)('%s °C beside the wind', (t, value) => {
    render(<BuoyPopup reading={reading(PLATFORM, { waterTemp: t })} />);
    expect(dd('Agua')).toBe(value);
  });

  it('a buoy that measures only the water says it in the big line, not twice', () => {
    render(<BuoyPopup reading={reading(PLATFORM, { windSpeed: null, windDir: null, windGust: null, waterTemp: 14 })} />);
    expect(document.querySelector('.gf-figure')?.textContent).toBe('14,0 °C');
    expect(dd('Agua')).toBeUndefined();
  });
});

describe('for whoever asks for more', () => {
  const full = reading(PLATFORM, {
    waveHeight: 1.4, wavePeriodMean: 7.2, airPressure: 1014.6, currentSpeed: 0.21, currentDir: 90, salinity: 35.1, dewPoint: 11.3,
  });

  it.each([
    ['Periodo medio', '7,2 s'], ['Presión', '1015 hPa'], ['Corriente', '21 cm/s hacia E'], ['Salinidad', '35,1 PSU'], ['Punto de rocío', '11,3 °C'],
  ] as const)('%s: in the advanced card, not in the simple one', (label, value) => {
    render(<BuoyPopup reading={full} />);
    expect(dd(label)).toBe(value);
    cleanup();
    useUIStore.setState({ simpleMode: true });
    render(<BuoyPopup reading={full} />);
    expect(dd(label)).toBeUndefined();
  });
});

describe('the sea level', () => {
  it.each([
    ['a tide gauge, simple card', GAUGE, {}, true, true],
    ['a wave buoy, simple card', PLATFORM, { waveHeight: 1.4 }, true, false],
    ['a buoy with wind, simple card', PLATFORM, {}, true, false],
    ['a buoy with neither sea nor wind, simple card', PLATFORM, { windSpeed: null, windGust: null, windDir: null }, true, true],
    ['any buoy, advanced card', PLATFORM, { waveHeight: 1.4 }, false, true],
  ] as const)('%s', (_, id, over, simple, shown) => {
    useUIStore.setState({ simpleMode: simple });
    render(<BuoyPopup reading={reading(id, { seaLevel: 2.61, ...over })} />);
    expect(dd('Nivel del mar')).toBe(shown ? '2,61 m' : undefined);
  });
});

describe('an old reading', () => {
  it('a fresh one says nothing about being old; one of hours ago says the values are from then', () => {
    render(<BuoyPopup reading={reading(PLATFORM, { timestamp: ago(10) })} />);
    expect(document.body.textContent).not.toContain('Sin datos nuevos');
    cleanup();
    render(<BuoyPopup reading={reading(PLATFORM, { timestamp: ago(6 * 60) })} />);
    expect(document.body.textContent).toContain('Sin datos nuevos: último envío hace 6 h. Los valores son de entonces.');
  });
});
