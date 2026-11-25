/**
 * What the spot card hands to the beach-day rule: the random breaks of 11-nov turned «rain soon» round and a missing
 * gust into 0 kt, and the whole suite stayed green. Each test was checked to fail with its one-token break.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

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
vi.mock('../../services/beachDayService', async (orig) => {
  const real = await orig<typeof import('../../services/beachDayService')>();
  return { ...real, assessBeachDay: vi.fn(real.assessBeachDay) };
});
vi.mock('../../hooks/useHistoricalBaseline', () => ({ useHistoricalBaseline: () => ({ baseline: null, loading: false }) }));
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
import type { SpotScore } from '../../services/spotScoringEngine';
import type { HourlyForecast } from '../../types/forecast';

const HOUR = 3_600_000;
const VAO = ALL_SPOTS.find((s) => s.id === 'vao')!;

function score(over: Record<string, unknown> = {}): SpotScore {
  return {
    spotId: VAO.id, spotName: VAO.id, verdict: 'sailing', score: 50, summary: 'Navegable', reason: 'Navegable',
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

/** What the card passed to the beach rule on its last render */
const handed = () => vi.mocked(assessBeachDay).mock.calls.at(-1)![0];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-15T13:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(h.pending));
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
  useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), spotForecasts: new Map(), thermalPrecursors: new Map() } as never);
});

describe('what the card hands to the beach-day rule', () => {
  it('the spot of the test is a beach, or nothing below is being looked at', () => {
    expect(isBeachSpot(VAO.id)).toBe(true);
  });

  it('a dry sky with no rain on the way: neither raining nor rain soon', () => {
    seed(score());
    render(<SpotPopup spot={VAO} />);
    expect(assessBeachDay).toHaveBeenCalled();
    expect(handed().rainingNow).toBe(false);
    expect(handed().rainSoon).toBe(false);
  });

  it('rain on the radar heading here in 15 min: rain soon', () => {
    seed(score());
    useRainNowStore.setState({ summary: { sim: false, gauges: [], arrivals: [{ spotId: VAO.id, spotName: VAO.id, etaMin: 15, distanceKm: 10 }] } } as never);
    render(<SpotPopup spot={VAO} />);
    expect(document.body.textContent).toContain('Lluvia en ~15 min (radar)');
    expect(handed().rainSoon).toBe(true);
    expect(handed().rainingNow).toBe(false);
  });

  it('the gust the engine gives goes as it is, and a missing one goes as missing, never as 0 kt', () => {
    seed(score({ gustKt: 14 }));
    render(<SpotPopup spot={VAO} />);
    expect(handed().gustKt).toBe(14);
    cleanup();
    vi.mocked(assessBeachDay).mockClear();

    seed(score({ gustKt: undefined }));
    render(<SpotPopup spot={VAO} />);
    expect(handed().gustKt).toBeNull();
  });
});
