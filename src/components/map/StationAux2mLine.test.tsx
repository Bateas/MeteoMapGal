/**
 * The 2 m wind line in the popup of a MeteoGalicia station without 10 m wind.
 *
 * Shadow data: it is shown as what it is, only in that station's popup, and nothing renders when
 * the endpoint has no fresh reading (404 included: the endpoint may not be deployed yet).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

import { StationAux2mLine } from './StationAux2mLine';
import { StationPopup } from './StationPopup';
import { useUIStore } from '../../store/uiStore';
import {
  __clearMgAuxLatestCacheForTests,
  formatAux2mWind,
  parseMgAuxLatest,
} from '../../api/mgAuxLatestClient';
import type { NormalizedStation, NormalizedReading } from '../../types/station';

const answer = (reading: unknown) =>
  Promise.resolve(new Response(JSON.stringify({ stationId: 'mg_19032', shadow: true, reading }), { status: 200 }));

const READING = { stationId: 'mg_19032', time: new Date().toISOString(), wind2m: 1.03, gust2m: 3.6, dir2m: 225 };

const mgStation: NormalizedStation = {
  id: 'mg_19032', source: 'meteogalicia', name: 'Prado', lat: 42.29, lon: -8.11, altitude: 100,
};

const reading = (windSpeed: number | null): NormalizedReading => ({
  stationId: mgStation.id,
  timestamp: new Date(),
  windSpeed,
  windGust: null,
  windDirection: null,
  temperature: 14,
  humidity: 80,
  precipitation: null,
  solarRadiation: null,
  pressure: null,
  dewPoint: null,
} as NormalizedReading);

beforeEach(() => {
  __clearMgAuxLatestCacheForTests();
  useUIStore.setState({ isMobile: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useUIStore.setState({ isMobile: false });
});

describe('formatAux2mWind', () => {
  it('says gust, direction and mean in knots', () => {
    expect(formatAux2mWind({ stationId: 'mg_1', time: new Date(), wind2m: 1.03, gust2m: 3.6, dir2m: 225 }))
      .toBe('racha 7 kt del SW (media 2 kt)');
  });
  it('leaves out the mean when it is missing (it often is)', () => {
    expect(formatAux2mWind({ stationId: 'mg_1', time: new Date(), wind2m: null, gust2m: 3.6, dir2m: 270 }))
      .toBe('racha 7 kt del W');
  });
});

describe('parseMgAuxLatest', () => {
  it('rejects an empty or speedless answer', () => {
    expect(parseMgAuxLatest({ reading: null })).toBeNull();
    expect(parseMgAuxLatest(null)).toBeNull();
    expect(parseMgAuxLatest({ reading: { ...READING, wind2m: null, gust2m: null } })).toBeNull();
  });
});

describe('StationAux2mLine', () => {
  it('renders the line with the reading and the honest caveat', async () => {
    const fetchMock = vi.fn((_url: string) => answer(READING));
    vi.stubGlobal('fetch', fetchMock);
    render(<StationAux2mLine stationId="mg_19032" />);
    const line = await screen.findByTestId('station-aux-2m');
    expect(line.textContent).toContain('Viento a 2 m:');
    expect(line.textContent).toContain('racha 7 kt del SW (media 2 kt)');
    expect(line.textContent).toContain('medido entre cultivos, no es el viento del agua');
    expect(line.textContent).toContain('no entra en los veredictos');
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/v1/stations/mg-aux-latest?station_id=mg_19032');
  });

  it('renders nothing without a reading', async () => {
    const fetchMock = vi.fn((_url: string) => answer(null));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<StationAux2mLine stationId="mg_19032" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the endpoint is not there (404)', async () => {
    const fetchMock = vi.fn((_url: string) => Promise.resolve(new Response("not found", { status: 404 })));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<StationAux2mLine stationId="mg_19032" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });
});

describe('StationPopup and the 2 m line', () => {
  it('shows it for a MeteoGalicia station without 10 m wind', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string) => answer(READING)));
    render(<StationPopup station={mgStation} reading={reading(null)} />);
    expect(await screen.findByTestId('station-aux-2m')).toBeTruthy();
  });

  it('does not ask when the station has its 10 m wind', () => {
    const fetchMock = vi.fn((_url: string) => answer(READING));
    vi.stubGlobal('fetch', fetchMock);
    render(<StationPopup station={mgStation} reading={reading(3)} />);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('mg-aux-latest'))).toBe(false);
  });

  it('does not ask for a station of another network', () => {
    const fetchMock = vi.fn((_url: string) => answer(READING));
    vi.stubGlobal('fetch', fetchMock);
    render(<StationPopup station={{ ...mgStation, id: 'aemet_1690A', source: 'aemet' }} reading={reading(null)} />);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('mg-aux-latest'))).toBe(false);
  });
});
