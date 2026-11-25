/**
 * Lines of the spot card that nothing was looking at: each test here reads what a person sees on the card, and each
 * was checked to fail with the one-token break that had gone through the whole suite green on 5-nov
 * (_herramientas/mutantes.mjs, ids A16, A10, A26, A29, A30, A38).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  pending: () => new Promise<never>(() => {}),
  baseline: null as null | { avg: number; p50: number; p75: number; p90: number; maxGust: number | null; hoursSampled: number },
}));

vi.mock('react-map-gl/maplibre', async () => {
  const React = await import('react');
  const { createPortal } = await import('react-dom');
  const Marker = React.forwardRef<unknown, { children?: React.ReactNode }>(function Marker({ children }, ref) {
    const el = React.useMemo(() => document.createElement('div'), []);
    React.useImperativeHandle(ref, () => ({ getElement: () => el }), [el]);
    React.useEffect(() => {
      document.body.appendChild(el);
      return () => { el.remove(); };
    }, [el]);
    return createPortal(children, el);
  });
  return { Marker, useMap: () => ({ current: null }) };
});
vi.mock('../../services/spotForecastFetch', async (orig) => ({ ...(await orig<typeof import('../../services/spotForecastFetch')>()), fetchSpotForecast: vi.fn(h.pending) }));
vi.mock('../../api/marineClient', async (orig) => ({ ...(await orig<typeof import('../../api/marineClient')>()), fetchMarineForecast: vi.fn(h.pending), fetchMarineData: vi.fn(h.pending) }));
vi.mock('../../api/meteoSixClient', async (orig) => ({ ...(await orig<typeof import('../../api/meteoSixClient')>()), fetchMeteoSixSeaTemp: vi.fn(h.pending) }));
vi.mock('../../api/swanGetFeatureInfo', async (orig) => ({ ...(await orig<typeof import('../../api/swanGetFeatureInfo')>()), fetchSwanHsAt: vi.fn(h.pending) }));
vi.mock('../../api/tideClient', async (orig) => ({ ...(await orig<typeof import('../../api/tideClient')>()), fetchTidePredictions: vi.fn(h.pending), fetchTides48h: vi.fn(h.pending) }));
vi.mock('../../services/beachDayService', async (orig) => {
  const real = await orig<typeof import('../../services/beachDayService')>();
  return { ...real, assessBeachDay: vi.fn(real.assessBeachDay) };
});
vi.mock('../../hooks/useHistoricalBaseline', () => ({ useHistoricalBaseline: () => ({ baseline: h.baseline, loading: false }) }));
vi.mock('../spot/SpotWarningNotice', () => ({ SpotWarningNotice: () => null }));
vi.mock('../spot/WindNowNext', async (orig) => ({ ...(await orig<typeof import('../spot/WindNowNext')>()), WindNowNext: () => null }));
vi.mock('../spot/SpotReportBox', () => ({ SpotReportBox: () => null }));

import { SpotPopup } from './SpotPopup';
import { assessBeachDay } from '../../services/beachDayService';
import { ALL_SPOTS, isBeachSpot } from '../../config/spots';
import { SECTORS } from '../../config/sectors';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { useRainNowStore } from '../../store/rainNowStore';
import { useAirQualityStore } from '../../store/airQualityStore';
import type { SpotScore } from '../../services/spotScoringEngine';
import type { HourlyForecast } from '../../types/forecast';

const HOUR = 3_600_000;
const VAO = ALL_SPOTS.find((s) => s.id === 'vao')!;
const OTHER = ALL_SPOTS.find((s) => s.id !== 'vao' && s.category !== 'surf')!;

function score(spotId: string, over: Record<string, unknown> = {}): SpotScore {
  return {
    spotId, spotName: spotId, verdict: 'sailing', score: 50, summary: 'Navegable', reason: 'Navegable',
    wind: { stationCount: 3, avgSpeedKt: 6, rawAvgSpeedKt: 6, dominantDir: 'NE', dirDeg: 45 },
    waves: null, waterTemp: 17, airTemp: 24, humidity: 60, windChill: null, heatIndex: null, windDirDeg: 45,
    hardGateTriggered: null, thermal: null, hasStormAlert: false, thermalBoosted: false, effectiveWindKt: 11,
    scoringConfidence: 'medium', provisional: false, windTrend: null, gustKt: 14, dewPoint: null, humiditySignal: null,
    thetaVGradient: null, computedAt: new Date(), ...over,
  } as unknown as SpotScore;
}

function hours(): HourlyForecast[] {
  const start = Math.floor(Date.now() / HOUR) * HOUR;
  return Array.from({ length: 12 }, (_, i) => ({
    time: new Date(start + i * HOUR), temperature: 24, humidity: 60, windSpeed: 5, windDirection: 45, windGusts: 7,
    precipitation: 0, precipProbability: 0, cloudCover: 10, pressure: 1020, solarRadiation: 700, cape: null,
    boundaryLayerHeight: null, visibility: null, liftedIndex: null, cin: null, snowLevel: null, skyState: null, isDay: true,
  })) as unknown as HourlyForecast[];
}

function seed(s: SpotScore) {
  useSpotStore.setState({
    scores: new Map([[s.spotId, s]]), lastScored: Date.now(), surfWaveCache: new Map(),
    spotForecasts: new Map([[s.spotId, { data: hours(), fetchedAt: Date.now() }]]),
    thermalPrecursors: new Map(),
  } as never);
}

const cardText = () => document.body.textContent ?? '';
const arrival = (spotId: string, etaMin: number) => ({ spotId, spotName: spotId, etaMin, distanceKm: 10 });
const air = (europeanAqi: number) => useAirQualityStore.setState({ data: { europeanAqi, uvIndex: 2, pm2_5: 5 } } as never);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-15T13:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(h.pending));
  h.baseline = null;
  vi.mocked(assessBeachDay).mockClear();
  useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! } as never);
  useUIStore.setState({ simpleMode: false, isMobile: false });
  useSpotStore.getState().selectSpot('');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(assessBeachDay).mockReset();
  useRainNowStore.setState({ summary: null } as never);
  useAirQualityStore.setState({ data: null } as never);
  useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), spotForecasts: new Map(), thermalPrecursors: new Map() } as never);
});

describe('rain on the radar: the arrival quoted is the one of this spot', () => {
  it('with two spots in the path, the card gives its own minutes and not the neighbour ones', () => {
    seed(score(VAO.id));
    useRainNowStore.setState({ summary: { sim: false, gauges: [], arrivals: [arrival(OTHER.id, 40), arrival(VAO.id, 15)] } } as never);
    render(<SpotPopup spot={VAO} />);
    expect(cardText()).toContain('Lluvia en ~15 min (radar)');
    expect(cardText()).not.toContain('~40 min');
  });

  it('rain heading only for the neighbour says nothing here', () => {
    seed(score(VAO.id));
    useRainNowStore.setState({ summary: { sim: false, gauges: [], arrivals: [arrival(OTHER.id, 40)] } } as never);
    render(<SpotPopup spot={VAO} />);
    expect(cardText()).not.toMatch(/Lluvia en ~\d+ min/);
  });
});

describe('air quality: the note comes out with bad air and only then', () => {
  it('index 85 says «muy mala»', () => {
    seed(score(VAO.id));
    air(85);
    render(<SpotPopup spot={VAO} />);
    expect(cardText()).toContain('Calidad del aire: muy mala');
  });

  it('index 65 says «mala»', () => {
    seed(score(VAO.id));
    air(65);
    render(<SpotPopup spot={VAO} />);
    expect(cardText()).toMatch(/Calidad del aire: mala/);
  });

  it('index 30 says nothing about the air', () => {
    seed(score(VAO.id));
    air(30);
    render(<SpotPopup spot={VAO} />);
    expect(cardText()).not.toContain('Calidad del aire');
  });
});

describe('the beach line', () => {
  it('is there on a beach with a verdict', () => {
    expect(isBeachSpot(VAO.id)).toBe(true);
    seed(score(VAO.id));
    vi.mocked(assessBeachDay).mockReturnValue({ verdict: 'great', summary: 'Buen día de playa', reasons: ['24 °C'] } as never);
    render(<SpotPopup spot={VAO} />);
    expect(cardText()).toContain('¿Playa? Buen día de playa');
  });

  it('and is not there when the beach advice has nothing to say', () => {
    seed(score(VAO.id));
    vi.mocked(assessBeachDay).mockReturnValue({ verdict: 'unknown', summary: 'Sin datos', reasons: [] } as never);
    render(<SpotPopup spot={VAO} />);
    expect(cardText()).not.toContain('¿Playa?');
  });
});

describe('water temperature', () => {
  const cell = (label: string) => [...document.querySelectorAll('.gf-data > *')].find((c) => c.textContent?.startsWith(label));

  it('measured water has its cell, with the figure', () => {
    seed(score(VAO.id, { waterTemp: 17 }));
    render(<SpotPopup spot={VAO} />);
    expect(cardText()).toMatch(/Agua\s*17(,0)? °C/);
  });

  it('no water figure from anywhere: the air cell stays and no water cell is drawn', () => {
    seed(score(VAO.id, { waterTemp: null }));
    render(<SpotPopup spot={VAO} />);
    expect(cardText()).toMatch(/Aire\s*24(,0)? °C/);
    expect(cell('Agua')).toBeUndefined();
  });
});

describe('today against the last 30 days', () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: /Cómo lo sabemos/ }));

  it('a day well above the usual says so under «Cómo lo sabemos»', () => {
    h.baseline = { avg: 3, p50: 3, p75: 4, p90: 5, maxGust: 20, hoursSampled: 300 };
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    open();
    expect(cardText()).toContain('6 kt — top 10% últimos 30 días (media 3 kt)');
  });

  it('a day like any other says nothing', () => {
    h.baseline = { avg: 6, p50: 6, p75: 9, p90: 12, maxGust: 20, hoursSampled: 300 };
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    open();
    expect(cardText()).not.toContain('últimos 30 días');
  });
});

describe('thermal probability', () => {
  const thermal = (windWindow: { startHour: number; endHour: number } | null) =>
    ({ thermalProbability: 60, windWindow });

  it('with a window, it gives the hours', () => {
    seed(score(VAO.id, { thermal: thermal({ startHour: 14, endHour: 18 }) }));
    render(<SpotPopup spot={VAO} />);
    expect(cardText()).toContain('Térmica: 60 % de probabilidad, de 14 a 18 h');
  });

  it('without a window, only the probability', () => {
    seed(score(VAO.id, { thermal: thermal(null) }));
    render(<SpotPopup spot={VAO} />);
    expect(cardText()).toContain('Térmica: 60 % de probabilidad');
    expect(cardText()).not.toMatch(/de probabilidad, de/);
  });
});
