/**
 * Contract tests for what a station card says, in tables (17-nov, zone 2 of the plan): the heading, how gusty the
 * wind is, the rain, the figures for whoever asks for more and how far the dew point is from the air. They cover
 * breaks the full sweep of 12-nov left alive in StationPopup.tsx. Each was checked to fail with its break put in.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('react-map-gl/maplibre', () => ({ useMap: () => ({ current: null }) }));

import { StationPopup } from './StationPopup';
import { useWeatherStore } from '../../store/weatherStore';
import { useSpotStore } from '../../store/spotStore';
import { useUIStore } from '../../store/uiStore';
import type { NormalizedReading, NormalizedStation } from '../../types/station';

const MS_PER_KT = 0.514444;
const station = (): NormalizedStation => ({ id: 'mg_1', name: 'Remuíño', source: 'meteogalicia', lat: 42.2, lon: -8.1, altitude: 120 } as NormalizedStation);
const reading = (over: Partial<NormalizedReading> & { kt?: number; gustKt?: number | null } = {}): NormalizedReading => {
  const { kt = 10, gustKt = null, ...rest } = over;
  return {
    stationId: 'mg_1', timestamp: new Date(Date.now() - 5 * 60_000),
    windSpeed: kt * MS_PER_KT, windGust: gustKt != null ? gustKt * MS_PER_KT : null, windDirection: 150,
    temperature: null, humidity: null, precipitation: null, solarRadiation: null, pressure: null, dewPoint: null,
    ...rest,
  } as NormalizedReading;
};
const text = () => document.body.textContent ?? '';
const dd = (label: string) => [...document.querySelectorAll('dt')].find((d) => d.textContent === label)?.nextElementSibling?.textContent;
const side = () => document.querySelector('.gf-side b')?.textContent ?? '';

beforeEach(() => useUIStore.setState({ simpleMode: false }));
afterEach(() => {
  cleanup();
  useUIStore.setState({ simpleMode: false });
  useWeatherStore.setState({ readingHistory: new Map() });
  useSpotStore.setState({ scores: new Map() });
});

describe('where the wind comes from', () => {
  it.each([
    ['advanced: point and degrees', false, reading(), 'nudos del SSE 150°'],
    ['simple: only the point', true, reading(), 'nudos del SSE'],
    ['calm: no heading', false, reading({ kt: 0.3 }), 'nudos'],
    ['no vane: no heading', false, reading({ windDirection: null }), 'nudos'],
  ] as const)('%s', (_, simple, r, words) => {
    useUIStore.setState({ simpleMode: simple });
    render(<StationPopup station={station()} reading={r} />);
    expect(side()).toBe(words);
  });
});

describe('how gusty it is', () => {
  const gustLine = () => [...document.querySelectorAll('.gf-side span')].find((s) => s.textContent?.startsWith('racha'));

  it.each([
    [15, 'racha 15', 'turbulencia ligera'],
    [17, 'racha 17, racheado', 'turbulencia moderada'],
    [20, 'racha 20, muy racheado', 'turbulencia severa'],
  ] as const)('a %s kt gust over 10 kt', (g, words, title) => {
    render(<StationPopup station={station()} reading={reading({ gustKt: g })} />);
    expect(gustLine()?.textContent).toBe(words);
    expect(gustLine()?.getAttribute('title')).toContain(title);
  });

  it('over a calm mean there is no factor to give', () => {
    render(<StationPopup station={station()} reading={reading({ kt: 0.3, gustKt: 4 })} />);
    expect(gustLine()?.textContent).toBe('racha 4');
    expect(gustLine()?.getAttribute('title')).toBeNull();
  });
});

describe('what is measured there', () => {
  it.each([[null, undefined], [0, undefined], [1.2, '1,2 mm']] as const)('rain %s', (mm, value) => {
    render(<StationPopup station={station()} reading={reading({ precipitation: mm })} />);
    expect(dd('Lluvia')).toBe(value);
  });

  it('radiation, pressure and dew point are for whoever asks for more', () => {
    const r = reading({ solarRadiation: 420, pressure: 1016.4, dewPoint: 12, temperature: 15 });
    render(<StationPopup station={station()} reading={r} />);
    expect(dd('Radiación')).toBe('420 W/m²');
    expect(dd('Presión')).toBe('1016 hPa');
    expect(dd('Punto de rocío')).toBe('12,0 °C a 3,0° del aire');
    cleanup();
    useUIStore.setState({ simpleMode: true });
    render(<StationPopup station={station()} reading={r} />);
    expect(dd('Radiación')).toBeUndefined();
    expect(dd('Presión')).toBeUndefined();
    expect(dd('Punto de rocío')).toBeUndefined();
  });

  it('without the air temperature the dew point stands alone', () => {
    render(<StationPopup station={station()} reading={reading({ dewPoint: 12 })} />);
    expect(dd('Punto de rocío')).toBe('12,0 °C');
    expect(text()).not.toContain('del aire');
  });
});

describe('the colour of the figures, in chips (18-nov)', () => {
  it('the wind and the gust carry the tone of the scale; past the verdict, the two new steps', () => {
    render(<StationPopup station={station()} reading={reading({ kt: 18, gustKt: 41 })} />);
    const figure = document.querySelector('.gf-figchip') as HTMLElement;
    expect(figure.style.background).toBe('var(--g-c-fuerte)');
    const gust = document.querySelector('.gf-chip') as HTMLElement;
    expect(gust.textContent).toBe('41');
    expect(gust.style.background).toBe('var(--g-c-temporal)');
  });

  it('an old reading gets no colour: the colour says «now»', () => {
    render(<StationPopup station={station()} reading={reading({ kt: 18, gustKt: 30, timestamp: new Date(Date.now() - 6 * 3_600_000) })} />);
    expect(document.querySelector('.gf-figchip')).toBeNull();
    expect(document.querySelector('.gf-chip')).toBeNull();
  });
});
