/**
 * Five places of the spot card where a one-token break left the whole suite green (random breaks of 11-nov, second
 * batch): the heat index, the next hours of a wind spot, the line of the wave trend, «mañana» beside the peak and the
 * wave in the text that is shared. Each test was checked to fail with its break put in by hand.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ pending: () => new Promise<never>(() => {}) }));

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
vi.mock('../../hooks/useHistoricalBaseline', () => ({ useHistoricalBaseline: () => ({ baseline: null, loading: false }) }));
vi.mock('../spot/SpotWarningNotice', () => ({ SpotWarningNotice: () => null }));
vi.mock('../spot/WindNowNext', async (orig) => ({ ...(await orig<typeof import('../spot/WindNowNext')>()), WindNowNext: () => null }));
vi.mock('../spot/SpotReportBox', () => ({ SpotReportBox: () => null }));

import { SpotPopup } from './SpotPopup';
import { ALL_SPOTS } from '../../config/spots';
import { SECTORS } from '../../config/sectors';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { buildSurfEntry } from '../../services/surfVerdictEngine';
import type { SpotScore } from '../../services/spotScoringEngine';
import type { HourlyForecast } from '../../types/forecast';
import type { MarineForecastHour } from '../../api/marineClient';

const HOUR = 3_600_000;
const NOW = new Date('2026-07-15T13:00:00Z').getTime();
const VAO = ALL_SPOTS.find((s) => s.id === 'vao')!;
const SURF = ALL_SPOTS.find((s) => s.category === 'surf')!;

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

function windHours(): HourlyForecast[] {
  return Array.from({ length: 12 }, (_, i) => ({
    time: new Date(NOW + i * HOUR), temperature: 24, humidity: 60, windSpeed: 5, windDirection: 45, windGusts: 7,
    precipitation: 0, precipProbability: 0, cloudCover: 10, pressure: 1020, solarRadiation: 700, cape: null,
    boundaryLayerHeight: null, visibility: null, liftedIndex: null, cin: null, snowLevel: null, skyState: null, isDay: true,
  })) as unknown as HourlyForecast[];
}

/** Waves of the model, one row per `stepMs` from `fromMs`, the same swell all along but the height. */
function waveHours(fromMs: number, stepMs: number, heights: number[]): MarineForecastHour[] {
  return heights.map((m, i) => ({
    time: new Date(fromMs + i * stepMs), waveHeight: m, wavePeriod: 10, waveDirection: 300,
    swellHeight: m, swellPeriod: 10, swellDirection: 300,
  }));
}

function seed(s: SpotScore, waves?: MarineForecastHour[]) {
  useSpotStore.setState({
    scores: new Map([[s.spotId, s]]), lastScored: Date.now(),
    surfWaveCache: waves ? new Map([[s.spotId, buildSurfEntry(SURF as never, waves, s, NOW, NOW, false)]]) : new Map(),
    spotForecasts: new Map([[s.spotId, { data: windHours(), fetchedAt: Date.now() }]]),
    thermalPrecursors: new Map(),
  } as never);
}

const text = () => document.body.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  vi.stubGlobal('fetch', vi.fn(h.pending));
  useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! } as never);
  useUIStore.setState({ simpleMode: false, isMobile: false });
  useSpotStore.getState().selectSpot('');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), spotForecasts: new Map(), thermalPrecursors: new Map() } as never);
});

describe('heat index: a warning above 32, one more figure below', () => {
  it('35 shows without asking for more data', () => {
    seed(score(VAO.id, { heatIndex: 35 }));
    render(<SpotPopup spot={VAO} />);
    expect(text()).toContain('Índice de calor');
  });

  it('28 stays behind «Más datos»', () => {
    seed(score(VAO.id, { heatIndex: 28 }));
    render(<SpotPopup spot={VAO} />);
    expect(text()).not.toContain('Índice de calor');
    fireEvent.click(screen.getByRole('button', { name: 'Más datos' }));
    expect(text()).toContain('Índice de calor');
  });
});

describe('the next hours of wind', () => {
  it('a wind spot with a forecast has them', () => {
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(text()).toContain('Próximas horas');
  });

  it('a surf spot does not: its hours are the waves', () => {
    const s = score(SURF.id);
    seed(s, waveHours(NOW, HOUR, Array.from({ length: 24 }, () => 1)));
    render(<SpotPopup spot={SURF} />);
    expect(text()).toContain('Olas 24 h');
    expect(text()).not.toContain('Próximas horas');
  });
});

describe('the line under the wave bars', () => {
  it('says the trend and the peak of today without «mañana»', () => {
    const heights = Array.from({ length: 24 }, (_, i) => (i === 3 ? 2 : 1));
    seed(score(SURF.id), waveHours(NOW, HOUR, heights));
    render(<SpotPopup spot={SURF} />);
    expect(text()).toMatch(/Olas subiendo: .* ahora → máx .* a las /);
    expect(text()).not.toContain('mañana a las');
  });

  it('a peak that falls tomorrow says so', () => {
    const heights = Array.from({ length: 24 }, (_, i) => (i === 20 ? 2 : 1));
    seed(score(SURF.id), waveHours(NOW, HOUR, heights));
    render(<SpotPopup spot={SURF} />);
    expect(text()).toMatch(/→ máx .* mañana a las /);
  });

  it('with no hour still to come there is no trend, and no line that reads «Olas null»', () => {
    // Seven rows every 8 min, the last one a minute ago: bars to draw, a wave for now, nothing ahead.
    seed(score(SURF.id), waveHours(NOW - 49 * 60_000, 8 * 60_000, Array.from({ length: 7 }, () => 1)));
    render(<SpotPopup spot={SURF} />);
    expect(text()).toContain('Olas 24 h');
    expect(text()).not.toContain('Olas null');
    expect(text()).not.toMatch(/Olas (subiendo|bajando|estables)/);
  });
});

describe('what is shared from a surf spot', () => {
  const shared = () => {
    const share = vi.fn(async (_data: { text: string }) => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    fireEvent.click(screen.getByTitle('Compartir condiciones'));
    return share.mock.calls[0][0].text;
  };
  afterEach(() => { delete (navigator as unknown as { share?: unknown }).share; });

  it('with a wave from the model, it goes with its «(modelo)»', () => {
    seed(score(SURF.id), waveHours(NOW, HOUR, Array.from({ length: 24 }, () => 1)));
    render(<SpotPopup spot={SURF} />);
    expect(shared()).toMatch(/olas ~.* m \(modelo\)/);
  });

  it('without wave data it does not say «olas» at all, never a wave of 0', () => {
    seed(score(SURF.id), []);
    render(<SpotPopup spot={SURF} />);
    expect(shared()).not.toContain('olas');
  });
});
