/**
 * Two lines of the buoy card that the random breaks of 11-nov went through with the whole suite green: which station
 * the card describes, and the tone of the water note. Each test was checked to fail with its one-token break.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('react-map-gl/maplibre', () => ({ useMap: () => ({ current: null }) }));

import { BuoyPopup } from './BuoyPopup';
import { RIAS_BUOY_STATIONS } from '../../api/buoyClient';
import type { BuoyReading } from '../../api/buoyClient';
import { useUIStore } from '../../store/uiStore';

const station = (id: number) => RIAS_BUOY_STATIONS.find((s) => s.id === id)!;
const reading = (id: number, over: Partial<BuoyReading> = {}): BuoyReading => ({
  stationId: id, stationName: station(id).name, timestamp: new Date(), waveHeight: null, waveHeightMax: null, wavePeriod: null,
  wavePeriodMean: null, waveDir: null, windSpeed: 5, windDir: 90, windGust: 7, waterTemp: null,
  airTemp: null, airPressure: null, currentSpeed: null, currentDir: null, salinity: null, seaLevel: null,
  humidity: null, dewPoint: null, ...over,
} as BuoyReading);

const credit = () => document.querySelector('.gf-credit')!.textContent ?? '';
const waterNote = () => document.querySelector('.gf-notes .gf-note');

// The network's name and the kinds of water are for who asks for more: these two read the advanced card.
beforeEach(() => useUIStore.setState({ simpleMode: false }));
afterEach(cleanup);

describe('the buoy card describes its own station', () => {
  it('a tide gauge says its network and its provider, a Xunta platform says its own', () => {
    render(<BuoyPopup reading={reading(3221)} />);
    expect(credit()).toContain(`Red ${station(3221).type}`);
    expect(credit()).toContain('Puertos del Estado');
    cleanup();

    render(<BuoyPopup reading={reading(1253)} />);
    expect(credit()).toContain(`Red ${station(1253).type}`);
    expect(credit()).toContain('Xunta');
    expect(station(3221).type).not.toBe(station(1253).type);
  });
});

describe('the note about the kind of water', () => {
  it('an impossible temperature is the strong tone', () => {
    render(<BuoyPopup reading={reading(1253, { waterTemp: 9 })} />);
    expect(waterNote()).not.toBeNull();
    expect(waterNote()!.className).toContain('gc-t-alto');
    expect(waterNote()!.className).not.toContain('gc-t-riesgo');
  });

  it('river water is the mild one', () => {
    render(<BuoyPopup reading={reading(1253, { waterTemp: 15, salinity: 30 })} />);
    expect(waterNote()).not.toBeNull();
    expect(waterNote()!.className).toContain('gc-t-riesgo');
    expect(waterNote()!.className).not.toContain('gc-t-alto');
  });
});

describe('simple mode: the same buoy, without the words that change nothing', () => {
  beforeEach(() => useUIStore.setState({ simpleMode: true }));

  it('keeps who the data come from and drops the name of the network', () => {
    render(<BuoyPopup reading={reading(3221)} />);
    expect(credit()).toContain('Puertos del Estado');
    expect(credit()).not.toContain('Red ');
  });

  it('says where the wind comes from in a word, without degrees', () => {
    render(<BuoyPopup reading={reading(1253)} />);
    const side = document.querySelector('.gf-side')!.textContent ?? '';
    expect(side).toContain('del E');
    expect(side).not.toContain('°');
  });

  it('the water that warns stays, the name of a water mass goes', () => {
    render(<BuoyPopup reading={reading(1253, { waterTemp: 9 })} />);
    expect(waterNote()!.className).toContain('gc-t-alto');
    cleanup();
    render(<BuoyPopup reading={reading(1253, { waterTemp: 15, salinity: 30 })} />);
    expect(waterNote()).toBeNull();
  });
});

describe('random breaks of 12-nov night', () => {
  it('a reading ten minutes old is not «ahora»', () => {
    render(<BuoyPopup reading={reading(1253, { timestamp: new Date(Date.now() - 10 * 60_000).toISOString() })} />);
    expect(document.body.textContent).toContain('Boya · hace 10 min');
    expect(document.body.textContent).not.toContain('Boya · ahora');
  });

  it('humidity shows in the advanced card and not in the simple one', () => {
    render(<BuoyPopup reading={reading(1253, { humidity: 82 })} />);
    expect(document.body.textContent).toContain('Humedad');
    cleanup();
    useUIStore.setState({ simpleMode: true });
    render(<BuoyPopup reading={reading(1253, { humidity: 82 })} />);
    expect(document.body.textContent).not.toContain('Humedad');
    useUIStore.setState({ simpleMode: false });
  });
});

describe('random breaks of 13-nov', () => {
  it('a buoy that sends a period but no wave height shows no wave rows', () => {
    render(<BuoyPopup reading={reading(1253, { waveHeight: null, wavePeriod: 8, waveHeightMax: 1.5 })} />);
    expect(document.body.textContent).not.toContain('Periodo');
    expect(document.body.textContent).not.toContain('Ola máxima');
  });
});
