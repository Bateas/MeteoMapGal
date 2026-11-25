/**
 * Six places of the spot card where a one-token break left the whole suite green (random breaks of 12-nov): the
 * line of the breeze turning (viración), where it may show and with what confidence, the tide a beach likes, the
 * age of the data said once, the «Más datos» of the temperatures; and, from the batch of that night, the shape of a
 * beach still loading, a beach with no offshore wind known and the last hour of light. Each test was checked to fail with its break.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  pending: () => new Promise<never>(() => {}),
  viracion: { phase: 'viracion', confidence: 'high', isOnPattern: true, description: 'Entra la viración ahora', sources: {} } as Record<string, unknown>,
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
vi.mock('../../hooks/useHistoricalBaseline', () => ({ useHistoricalBaseline: () => ({ baseline: null, loading: false }) }));
vi.mock('../spot/SpotWarningNotice', () => ({ SpotWarningNotice: () => null }));
vi.mock('../spot/WindNowNext', async (orig) => ({ ...(await orig<typeof import('../spot/WindNowNext')>()), WindNowNext: () => null }));
vi.mock('../spot/SpotReportBox', () => ({ SpotReportBox: () => null }));
vi.mock('../../services/viracionDetector', async (orig) => ({ ...(await orig<typeof import('../../services/viracionDetector')>()), detectViracionPhase: vi.fn(() => h.viracion) }));

import { SpotPopup } from './SpotPopup';
import { ALL_SPOTS, EMBALSE_SPOTS } from '../../config/spots';
import { SECTORS } from '../../config/sectors';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { buildSurfEntry } from '../../services/surfVerdictEngine';
import type { SpotScore } from '../../services/spotScoringEngine';
import { getSunTimes } from '../../services/solarUtils';
import { useForecastStore } from '../../hooks/useForecastTimeline';
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

const CASTRELO = EMBALSE_SPOTS[0];

describe('the line of the breeze turning', () => {
  beforeEach(() => {
    h.viracion = { phase: 'viracion', confidence: 'high', isOnPattern: true, description: 'Entra la viración ahora', sources: {} };
  });

  it('a coastal wind spot shows a confident one', () => {
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(text()).toContain('Entra la viración ahora');
  });

  it('a phase it cannot name stays hidden, even said with confidence', () => {
    h.viracion = { ...h.viracion, phase: 'unknown' };
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(text()).not.toContain('Entra la viración ahora');
  });

  it('never on a surf beach: its card is the waves', () => {
    const s = score(SURF.id);
    seed(s, waveHours(NOW, HOUR, Array.from({ length: 24 }, () => 1)));
    render(<SpotPopup spot={SURF} />);
    expect(text()).not.toContain('Entra la viración ahora');
  });

  it('never inland: there is no sea breeze in the reservoir', () => {
    useSectorStore.setState({ activeSectorId: 'embalse', activeSector: SECTORS.find((s) => s.id === 'embalse')! } as never);
    seed(score(CASTRELO.id));
    render(<SpotPopup spot={CASTRELO} />);
    expect(text()).not.toContain('Entra la viración ahora');
  });
});

describe('the tide a beach likes', () => {
  it('a beach without a known preference says nothing of the tide', () => {
    const beach = { ...SURF, tidePreference: undefined };
    seed(score(SURF.id), waveHours(NOW, HOUR, Array.from({ length: 24 }, () => 1)));
    render(<SpotPopup spot={beach as never} />);
    fireEvent.click(screen.getByRole('button', { name: /Qué le va a esta playa/ }));
    expect(text()).toContain('Qué le va a esta playa');
    expect(screen.queryByText('Marea')).toBeNull();
  });
});

describe('how old the data is, said once', () => {
  it('old data: the age goes under the title, not again at the foot', () => {
    seed(score(VAO.id, { computedAt: new Date(NOW - 3 * HOUR) }));
    render(<SpotPopup spot={VAO} />);
    const said = text().match(/hace \d+ ?h/g) ?? [];
    expect(said.length).toBe(1);
  });
});

describe('the other temperatures behind «Más datos»', () => {
  it('humidity alone is reason enough for the button', () => {
    seed(score(VAO.id, { humidity: 70, dewPoint: null, windChill: null, heatIndex: null }));
    render(<SpotPopup spot={VAO} />);
    expect(screen.getByRole('button', { name: 'Más datos' })).toBeInTheDocument();
  });

  it('the wind chill waits for the button', () => {
    seed(score(VAO.id, { windChill: 5, heatIndex: null }));
    render(<SpotPopup spot={VAO} />);
    expect(text()).not.toContain('Sensación térmica');
    fireEvent.click(screen.getByRole('button', { name: 'Más datos' }));
    expect(text()).toContain('Sensación térmica');
  });
});

describe('random breaks of 12-nov night', () => {
  it('a beach whose waves are still loading has the thin outline of waiting, not the thick one of a model', () => {
    seed(score(SURF.id));
    render(<SpotPopup spot={SURF} />);
    expect(document.querySelector('.gf-chip polygon')!.getAttribute('stroke-width')).toBe('1.5');
  });

  it('a beach with no offshore wind known opens its fold without it', () => {
    const beach = { ...SURF, offshoreWindDir: undefined };
    seed(score(SURF.id), waveHours(NOW, HOUR, Array.from({ length: 24 }, () => 1)));
    render(<SpotPopup spot={beach as never} />);
    fireEvent.click(screen.getByRole('button', { name: /Qué le va a esta playa/ }));
    expect(screen.queryByText('Offshore')).toBeNull();
  });

  it('three quarters of an hour before sunset it says the minutes, without «0 h»', () => {
    const { sunset } = getSunTimes(new Date(NOW), VAO.center);
    vi.setSystemTime(new Date(sunset.getTime() - 45 * 60_000));
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(text()).toMatch(/Quedan 4[45] min de luz/);
    expect(text()).not.toContain('Quedan 0 h');
  });

  it('an hour before sunset it says «1 h», not «1 h 0 min»', () => {
    const { sunset } = getSunTimes(new Date(NOW), VAO.center);
    vi.setSystemTime(new Date(sunset.getTime() - 60 * 60_000 - 20_000));
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(text()).toContain('Quedan 1 h de luz');
  });
});

describe('random breaks of 13-nov', () => {
  afterEach(() => useForecastStore.setState({ hourly: [] } as never));

  it('a surf beach without its own forecast does not borrow the wind forecast of the zone', () => {
    const s = score(SURF.id);
    seed(s, waveHours(NOW, HOUR, Array.from({ length: 24 }, () => 1)));
    useSpotStore.setState({ spotForecasts: new Map() } as never);
    useForecastStore.setState({ hourly: windHours() } as never);
    render(<SpotPopup spot={SURF} />);
    expect(text()).not.toContain('De la zona (Open-Meteo)');
  });

  it('a wind spot without its own forecast does borrow it, and says so', () => {
    seed(score(VAO.id));
    useSpotStore.setState({ spotForecasts: new Map() } as never);
    useForecastStore.setState({ hourly: windHours() } as never);
    render(<SpotPopup spot={VAO} />);
    expect(text()).toMatch(/De la zona \(Open-Meteo\)|es la previsión de la zona/);
  });

  it('no beach day at night', () => {
    const { sunset } = getSunTimes(new Date(NOW), VAO.center);
    vi.setSystemTime(new Date(sunset.getTime() + 2 * HOUR));
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(text()).not.toContain('¿Playa?');
  });

  it('three quarters of an hour before sunrise it says so', () => {
    const { sunrise } = getSunTimes(new Date(NOW), VAO.center);
    vi.setSystemTime(new Date(sunrise.getTime() - 45 * 60_000));
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(text()).toMatch(/Amanece en 4[45] min/);
  });
});

describe('random breaks of 13-nov, second batch', () => {
  const closedBySea = () => score(VAO.id, {
    verdict: 'strong', hardGateTriggered: 'Oleaje', hardGateKind: 'wave',
    waves: { waveHeight: 3.4, localHeight: 3.4, localSource: 'buoy', wavePeriod: 11 },
  });

  it('a spot closed by the sea says the sea, and that its figure is not wind', () => {
    seed(closedBySea());
    render(<SpotPopup spot={VAO} />);
    expect(text()).toContain('Oleaje · 3,4 m');
    expect(text()).toMatch(/no es viento: 11 kt/);
  });

  it('the bearing in degrees goes with the advanced card only', () => {
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(text()).toMatch(/45°/);
    cleanup();
    useUIStore.setState({ simpleMode: true });
    seed(score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(text()).not.toMatch(/\b45°/);
    useUIStore.setState({ simpleMode: false });
  });

  it('with no water temperature anywhere, the beach line does not invent one', () => {
    seed(score(VAO.id, { waterTemp: null }));
    render(<SpotPopup spot={VAO} />);
    expect(text()).toContain('¿Playa?');
    expect(text()).not.toMatch(/Agua[^·]{0,12}\b0°/);
  });

  it('a wave measured at a buoy is not shown again as the wave of the zone', () => {
    const exposed = { ...VAO, waveRelevance: 'high' };
    seed(score(VAO.id, { waves: { waveHeight: 1.2, localHeight: 1.2, localSource: 'buoy', wavePeriod: 9 } }));
    render(<SpotPopup spot={exposed as never} />);
    expect(text()).not.toContain('Ola en la zona');
  });

  it('a wave of the SWAN model in the zone is shown, said as a model', () => {
    const exposed = { ...VAO, waveRelevance: 'high' };
    seed(score(VAO.id, { waves: { waveHeight: 1.2, localHeight: 0.8, localSource: 'swan', wavePeriod: 9 } }));
    render(<SpotPopup spot={exposed as never} />);
    expect(text()).toContain('Ola en la zona (modelo)');
  });
});
