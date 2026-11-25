/**
 * The rows of the side panel. A row concludes (name, wind, where it is going) and leaves the rest to the card:
 * what must not happen is a figure that looks valid and is not, or a trend about a wind long gone.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';
import { StationCard } from './StationCard';
import { BuoyPanel } from './BuoyPanel';
import { SpotSelector } from './SpotSelector';
import { SECTORS } from '../../config/sectors';
import { useBuoyStore } from '../../store/buoyStore';
import { useSectorStore } from '../../store/sectorStore';
import { useSpotStore } from '../../store/spotStore';
import { useUIStore } from '../../store/uiStore';
import { useWeatherStore } from '../../store/weatherStore';
import type { BuoyReading } from '../../api/buoyClient';
import type { SpotScore } from '../../services/spotScoringEngine';
import type { NormalizedReading, NormalizedStation } from '../../types/station';

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const KT = 0.514444;
const ago = (min: number) => new Date(NOW - min * 60_000);

const station = (id = 'mg_1', name = 'Porto de Vigo') =>
  ({ id, name, lat: 42.2, lon: -8.7, source: 'meteogalicia' }) as unknown as NormalizedStation;
const reading = (over: Partial<NormalizedReading> = {}) =>
  ({ stationId: 'mg_1', timestamp: ago(5), windSpeed: 14 * KT, windGust: 18 * KT, windDirection: 90, temperature: 15, ...over }) as unknown as NormalizedReading;

function renderRow(s: NormalizedStation, r?: NormalizedReading) {
  const { container } = render(<ul><StationCard station={s} reading={r} now={NOW} /></ul>);
  return container.querySelector('li')!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  useWeatherStore.setState({ readingHistory: new Map() });
  useUIStore.setState({ isMobile: false, sidebarOpen: false, listHover: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useUIStore.setState({ isMobile: false, listHover: null });
});

describe('a station row', () => {
  it('says the wind, the gust and the temperature, and no age while it is fresh', () => {
    const row = renderRow(station(), reading());
    expect(row.textContent).toContain('Porto de Vigo');
    expect(row.textContent).toContain('14 kt');
    expect(row.textContent).toContain('racha 18');
    expect(row.textContent).toContain('15°');
    expect(row.textContent).not.toContain('hace');
    expect(row.getAttribute('data-age')).toBe('fresh');
  });

  it('a gust no higher than the wind is not worth saying', () => {
    expect(renderRow(station(), reading({ windGust: 14 * KT })).textContent).not.toContain('racha');
  });

  it('a set-aside station does not show its wind as if it counted, and says so', () => {
    const row = renderRow(station('wu_IVIGO51', 'Vigo balcón'), reading());
    expect(row.textContent).toContain('Su viento no cuenta');
    expect(row.textContent).not.toContain('14 kt');
    expect(row.textContent).not.toContain('racha');
    expect(row.textContent).toContain('15°');
    expect(row.querySelector('.gc-rowarrow svg')).toBeNull();
  });

  it('where it is going, in one word, when the readings say it', () => {
    useWeatherStore.setState({
      readingHistory: new Map([['mg_1', [100, 90, 20, 10].map((min, i) => reading({ timestamp: ago(min), windSpeed: (i < 2 ? 6 : 14) * KT }))]]),
    });
    expect(renderRow(station(), reading()).textContent).toContain('sube');
  });

  it('an old figure loses ink and says its age; past 90 minutes it says no word of trend', () => {
    const history = [200, 190, 120, 100].map((min, i) => reading({ timestamp: ago(min), windSpeed: (i < 2 ? 6 : 14) * KT }));
    useWeatherStore.setState({ readingHistory: new Map([['mg_1', history]]) });

    const old = renderRow(station(), reading({ timestamp: ago(40) }));
    expect(old.getAttribute('data-age')).toBe('old');
    expect(old.textContent).toContain('hace 40 min');

    cleanup();
    const late = renderRow(station(), reading({ timestamp: ago(100) }));
    expect(late.textContent).toContain('hace 2 h');
    expect(late.textContent).not.toMatch(/sube|baja|estable/);

    cleanup();
    expect(renderRow(station(), reading({ timestamp: ago(150) })).getAttribute('data-age')).toBe('gone');
  });

  it('with no reading it says so, and no calm comes out of nothing', () => {
    const row = renderRow(station());
    expect(row.textContent).toContain('Sin datos');
    expect(row.textContent).not.toContain('kt');
  });

  it('a calm has no arrow: nothing is coming from anywhere', () => {
    expect(renderRow(station(), reading({ windSpeed: 0, windGust: 0 })).querySelector('.gc-rowarrow svg')).toBeNull();
  });
});

describe('the buoy rows', () => {
  const base = { waveHeight: null, windSpeed: null, seaLevel: null, waterTemp: null, timestamp: ago(5).toISOString() };
  const buoys = [
    { ...base, stationId: 2248, stationName: 'Cabo Silleiro', waveHeight: 1.29, waterTemp: 17.4 },
    { ...base, stationId: 1250, stationName: 'Cortegada (Arousa)', windSpeed: 10 * KT, waterTemp: 14 },
    { ...base, stationId: 3220, stationName: 'Vilagarcía (marea)', waveHeight: 0.02, windSpeed: 0.8, seaLevel: 3.27 },
  ] as unknown as BuoyReading[];

  beforeEach(() => useBuoyStore.setState({ buoys, loading: false, error: null, lastFetch: NOW, selectedBuoyId: null }));
  afterEach(() => useBuoyStore.setState({ buoys: [], lastFetch: 0 }));

  const open = () => {
    const { container } = render(<BuoyPanel />);
    fireEvent.click(within(container).getByRole('button', { name: /Boyas marinas/ }));
    return container;
  };

  it('are folded until asked for', () => {
    const { container } = render(<BuoyPanel />);
    expect(container.querySelector('.gc-list')).toBeNull();
    expect(container.textContent).toContain('Boyas marinas');
    expect(container.textContent).toContain('3');
  });

  it('say the sea, or the wind, and the water, and who publishes them', () => {
    const rows = [...open().querySelectorAll('li')].map((r) => r.textContent);
    expect(rows[0]).toContain('1,3 m ola');
    expect(rows[0]).toContain('17° agua');
    expect(rows[1]).toContain('10 kt viento');
    expect(document.body.textContent).toContain('Puertos del Estado');
  });

  it('a tide gauge says its level, not the water of the dock as a wave', () => {
    const row = [...open().querySelectorAll('li')][2].textContent;
    expect(row).toContain('3,27 m nivel');
    expect(row).not.toContain('ola');
  });

  it('a poll under way does not take the open list away', () => {
    const container = open();
    useBuoyStore.setState({ loading: true });
    expect(container.querySelectorAll('li')).toHaveLength(3);
  });
});

describe('the spot rows', () => {
  const score = (over: Partial<SpotScore> = {}) => ({
    verdict: 'good', provisional: false, hardGateTriggered: null, computedAt: ago(2), matchedStations: 3, windTrend: null,
    wind: { avgSpeedKt: 13, dirDeg: 45, dominantDir: 'NE', stationCount: 3 }, ...over,
  }) as unknown as SpotScore;
  const listed = (container: HTMLElement) => [...container.querySelectorAll('li')].map((r) => r.querySelector('.gc-rowname')!.textContent);

  beforeEach(() => {
    useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! });
    useSpotStore.setState({
      scores: new Map([['cesantes', score()], ['bocana', score({ verdict: 'calm' })]]),
      surfWaveCache: new Map(), windHistory: new Map(), favoriteSpotId: null,
    });
    useSpotStore.getState().selectSpot('');
  });
  afterEach(() => useSpotStore.setState({ scores: new Map(), favoriteSpotId: null }));

  it('the star sits beside the row, not inside it: two controls one within the other are one for a keyboard', () => {
    const { container } = render(<SpotSelector />);
    expect(container.querySelector('button button, button [role="button"]')).toBeNull();
    expect(within(container).getByRole('button', { name: /favorito: Cesantes/ })).toBeTruthy();
  });

  it('the favourite goes first, whatever its verdict', () => {
    useSpotStore.setState({ favoriteSpotId: 'bocana' });
    const { container } = render(<SpotSelector />);
    expect(listed(container)[0]).toBe('Bocana');
  });

  it('with no favourite the best verdict goes first', () => {
    const { container } = render(<SpotSelector />);
    expect(listed(container).indexOf('Cesantes')).toBeLessThan(listed(container).indexOf('Bocana'));
  });

  it('says the verdict in words and the wind', () => {
    const { container } = render(<SpotSelector />);
    const row = [...container.querySelectorAll('li')].find((r) => /Cesantes/.test(r.textContent ?? ''))!;
    expect(row.textContent).toContain('Bueno');
    expect(row.textContent).toContain('13 kt');
  });

  it('still calculating: no verdict and no figure that will change in a minute', () => {
    useSpotStore.setState({ scores: new Map([['cesantes', score({ provisional: true })]]) });
    const { container } = render(<SpotSelector />);
    const row = [...container.querySelectorAll('li')].find((r) => /Cesantes/.test(r.textContent ?? ''))!;
    expect(row.textContent).toContain('Calculando');
    expect(row.textContent).not.toContain('13 kt');
    expect(row.textContent).not.toContain('Bueno');
  });

  it('tapping a row chooses the spot, flies to it, and on a phone gets the panel out of the way', () => {
    useUIStore.setState({ isMobile: true, sidebarOpen: true });
    const { container } = render(<SpotSelector />);
    const row = [...container.querySelectorAll('li')].find((r) => /Cesantes/.test(r.textContent ?? ''))!;
    fireEvent.click(row.querySelector('.gc-rowbtn')!);
    expect(useSpotStore.getState().activeSpotId).toBe('cesantes');
    expect(useUIStore.getState().sidebarOpen).toBe(false);
    expect(useUIStore.getState().flyToTarget?.zoom).toBe(12);
  });

  it('passing over a row marks its place on the map, on a desktop and from the keyboard, and leaving takes it away', () => {
    const { container } = render(<SpotSelector />);
    const row = container.querySelector('li')!;
    fireEvent.mouseEnter(row);
    expect(useUIStore.getState().listHover).not.toBeNull();
    fireEvent.mouseLeave(row);
    expect(useUIStore.getState().listHover).toBeNull();
    fireEvent.focus(row.querySelector('.gc-rowbtn')!);
    expect(useUIStore.getState().listHover).not.toBeNull();
    cleanup();
    expect(useUIStore.getState().listHover).toBeNull();
  });

  it('on a phone there is no pointer to pass over the rows, and the panel covers the map', () => {
    useUIStore.setState({ isMobile: true });
    const { container } = render(<SpotSelector />);
    fireEvent.mouseEnter(container.querySelector('li')!);
    expect(useUIStore.getState().listHover).toBeNull();
  });
});
