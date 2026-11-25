/**
 * One figure on every surface. The marker, the list, the card, the advice under it and the report box all have to work
 * from the figure a person is looking at: when they do not, a card says «Sin apenas viento» beside «Bueno, 13». Every
 * test here was added because the same break went through the whole suite green on 5-nov (_herramientas/mutantes.mjs).
 * Raw mean 6 kt, calibrated 11 kt: a surface reading the wrong one gives itself away.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  pending: () => new Promise<never>(() => {}),
  notice: [] as { windKt: number | null }[],
  next: [] as { nowKt: number }[],
  report: [] as { shownWindKt: number | null }[],
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
vi.mock('../spot/SpotWarningNotice', () => ({ SpotWarningNotice: (p: { windKt: number | null }) => { h.notice.push(p); return null; } }));
vi.mock('../spot/WindNowNext', async (orig) => ({ ...(await orig<typeof import('../spot/WindNowNext')>()), WindNowNext: (p: { nowKt: number }) => { h.next.push(p); return null; } }));
vi.mock('../spot/SpotReportBox', () => ({ SpotReportBox: (p: { shownWindKt: number | null }) => { h.report.push(p); return null; } }));

import { SpotPopup } from './SpotPopup';
import { SpotMarkers } from './SpotMarker';
import { SpotSelector } from '../dashboard/SpotSelector';
import { assessBeachDay } from '../../services/beachDayService';
import { formatThermalCountdown, type ThermalPrecursorResult } from '../../services/thermalPrecursorService';
import { buildSurfEntry } from '../../services/surfVerdictEngine';
import { ALL_SPOTS, isBeachSpot } from '../../config/spots';
import { SECTORS } from '../../config/sectors';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import type { SpotScore } from '../../services/spotScoringEngine';
import type { HourlyForecast } from '../../types/forecast';

const HOUR = 3_600_000;
const VAO = ALL_SPOTS.find((s) => s.id === 'vao')!;
const CORRUBEDO = ALL_SPOTS.find((s) => s.id === 'surf-corrubedo')!;

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

const lastOf = <T,>(list: T[]) => list[list.length - 1];

beforeEach(() => {
  // Daytime in July: the beach line only speaks in daylight. Only Date is faked.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-15T13:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(h.pending));
  h.notice.length = 0;
  h.next.length = 0;
  h.report.length = 0;
  vi.mocked(assessBeachDay).mockClear();
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

describe('one figure: 11 kt, on every surface', () => {
  it('marker, list and card say the same', () => {
    seed(score(VAO.id));
    render(<SpotMarkers />);
    expect(screen.getByRole('button', { name: new RegExp(`^Spot ${VAO.shortName}`) }).getAttribute('aria-label')).toMatch(/\b11 kt/);
    const list = render(<SpotSelector />);
    const row = within(list.container).getAllByRole('button').find((b) => b.textContent?.includes(VAO.shortName))!;
    expect(row.textContent).toMatch(/11 kt/);
    render(<SpotPopup spot={VAO} />);
    expect(document.querySelector('.gf-figure')!.textContent).toMatch(/\b11\b/);
  });

  it('the notice of the orange warning reads it', () => {
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(lastOf(h.notice).windKt).toBe(11);
  });

  it('and no figure at all while it is still calculating', () => {
    seed(score(VAO.id, { provisional: true }));
    render(<SpotPopup spot={VAO} />);
    expect(lastOf(h.notice).windKt).toBeNull();
    expect(h.next).toHaveLength(0);
    expect(h.report).toHaveLength(0);
  });

  it('the beach advice reads it: the raw mean said «Sin apenas viento» beside «Bueno, 13»', () => {
    expect(isBeachSpot(VAO.id)).toBe(true);
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(assessBeachDay).toHaveBeenCalled();
    expect(vi.mocked(assessBeachDay).mock.lastCall![0].windKt).toBe(11);
  });

  it('what is coming starts from it', () => {
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(lastOf(h.next).nowKt).toBe(11);
  });

  it('your report is compared with the figure you were looking at', () => {
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(lastOf(h.report).shownWindKt).toBe(11);
  });
});

describe('an image that outlives the correction', () => {
  const share = () => screen.queryByRole('button', { name: 'Compartir como imagen' });

  it('can be shared once the figure is firm', () => {
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(share()).not.toBeNull();
  });

  it('cannot while it is still calculating', () => {
    seed(score(VAO.id, { provisional: true }));
    render(<SpotPopup spot={VAO} />);
    expect(share()).toBeNull();
  });
});

describe('how old it is', () => {
  it('a score computed just now says nothing about it', () => {
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(document.body.textContent).not.toMatch(/hace \d+ ?h/);
  });

  it('a score two hours old says so, up where the figure is', () => {
    seed(score(VAO.id, { computedAt: new Date(Date.now() - 2 * HOUR) }));
    render(<SpotPopup spot={VAO} />);
    expect(document.querySelector('.gf-head')!.textContent).toMatch(/hace 2 ?h/);
  });
});

describe('the thermal line', () => {
  const spot = ALL_SPOTS.find((s) => s.thermalDetection && s.category !== 'surf')!;
  const precursor = (level: ThermalPrecursorResult['level']) => ({
    spotId: spot.id, probability: 40, confidence: 'medium', eta: null, etaMinutes: 60, signals: {}, summary: '', level, computedAt: new Date(),
  }) as unknown as ThermalPrecursorResult;

  function draw(level: ThermalPrecursorResult['level']) {
    seed(score(spot.id));
    useSpotStore.setState({ thermalPrecursors: new Map([[spot.id, precursor(level)]]) } as never);
    render(<SpotPopup spot={spot} />);
    return formatThermalCountdown(precursor(level))!.text;
  }

  it('says nothing while it is only watching: a watch is not a conclusion', () => {
    const text = draw('watch');
    expect(document.querySelector('.gf-name')).not.toBeNull();
    expect(document.body.textContent).not.toContain(text);
  });

  it('says it from probable on, in one line', () => {
    const text = draw('probable');
    expect(document.body.textContent).toContain(text);
  });
});

describe('the chip of a surf spot', () => {
  const chip = () => document.querySelector('.gf-chip polygon')!;

  it('with no wave data is empty, not painted as if there were a model', () => {
    const s = score(CORRUBEDO.id, { verdict: 'calm', effectiveWindKt: 4 });
    seed(s);
    useSpotStore.setState({ surfWaveCache: new Map([[CORRUBEDO.id, buildSurfEntry(CORRUBEDO, [], s, Date.now(), Date.now(), false)]]) } as never);
    render(<SpotPopup spot={CORRUBEDO} />);
    expect(chip().getAttribute('fill')).toBe('var(--g-hair)');
  });
});
