/**
 * Wind in knots on a buoy card. The API gives m/s: a card that forgets the conversion reads half of what blows and
 * nothing else would notice (this one went through the whole suite green on 5-nov).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('react-map-gl/maplibre', () => ({ useMap: () => ({ current: null }) }));

import { BuoyPopup } from './BuoyPopup';
import { RIAS_BUOY_STATIONS } from '../../api/buoyClient';
import type { BuoyReading } from '../../api/buoyClient';

const MS_PER_KT = 0.514444;
const buoy = RIAS_BUOY_STATIONS.find((s) => s.type !== 'REDMAR')!;
const reading = (over: Partial<BuoyReading>): BuoyReading => ({
  stationId: buoy.id, stationName: buoy.name, timestamp: new Date(), waveHeight: null, waveHeightMax: null, wavePeriod: null,
  wavePeriodMean: null, waveDir: null, windSpeed: 10 * MS_PER_KT, windDir: 90, windGust: 15 * MS_PER_KT, waterTemp: null,
  airTemp: null, airPressure: null, currentSpeed: null, currentDir: null, salinity: null, seaLevel: null,
  humidity: null, dewPoint: null, ...over,
} as BuoyReading);

afterEach(cleanup);

describe('the wind on a buoy card', () => {
  it('with no sea to show, the big figure is the wind in knots: 5,1 m/s reads 10, never 5', () => {
    render(<BuoyPopup reading={reading({})} />);
    expect(document.querySelector('.gf-figure')!.textContent).toBe('10');
    expect(document.body.textContent).toContain('nudos');
  });

  it('with sea to show, the wind goes in its cell, in knots too', () => {
    render(<BuoyPopup reading={reading({ waveHeight: 1.2 })} />);
    expect(document.querySelector('.gf-figure')!.textContent).toBe('1,2 m');
    expect(document.body.textContent).toContain('10 kt');
    expect(document.body.textContent).toContain('15 kt');
  });
});
