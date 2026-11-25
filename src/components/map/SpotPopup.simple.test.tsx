/**
 * The spot card in simple mode (11-nov: no empty words, think of the reader): verdict,
 * what can hurt, what comes, the place, the cameras and «Compartir». What asks something of the reader or
 * explains the workings is for «Avanzado». And two things that hold in both modes: a heading that is not
 * known and the trend do not read as one phrase, and the water label does not name a model.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';

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
vi.mock('../../api/meteoSixClient', async (orig) => ({ ...(await orig<typeof import('../../api/meteoSixClient')>()), fetchMeteoSixSeaTemp: vi.fn(() => Promise.resolve([{ time: new Date(), seaTemp: 14 }])) }));
vi.mock('../../api/swanGetFeatureInfo', async (orig) => ({ ...(await orig<typeof import('../../api/swanGetFeatureInfo')>()), fetchSwanHsAt: vi.fn(h.pending) }));
vi.mock('../../api/tideClient', async (orig) => ({
  ...(await orig<typeof import('../../api/tideClient')>()),
  fetchTidePredictions: vi.fn(() => Promise.resolve([
    { time: '04:35', height: 3.5, type: 'high' },
    { time: '10:45', height: 0.9, type: 'low' },
    { time: '16:54', height: 3.3, type: 'high' },
    { time: '22:54', height: 1.0, type: 'low' },
  ])),
  fetchTides48h: vi.fn(h.pending),
}));
vi.mock('../../hooks/useHistoricalBaseline', () => ({ useHistoricalBaseline: () => ({ baseline: null, loading: false }) }));
vi.mock('../../hooks/useMeteoTide', () => ({ useMeteoTide: () => null }));
vi.mock('../spot/SpotWarningNotice', () => ({ SpotWarningNotice: () => null }));
vi.mock('../spot/WindNowNext', async (orig) => ({ ...(await orig<typeof import('../spot/WindNowNext')>()), WindNowNext: () => null }));
vi.mock('../spot/SpotReportBox', () => ({ SpotReportBox: () => <div>caja de parte</div> }));

import { SpotPopup } from './SpotPopup';
import { ALL_SPOTS } from '../../config/spots';
import { SECTORS } from '../../config/sectors';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import type { SpotScore } from '../../services/spotScoringEngine';
import type { HourlyForecast } from '../../types/forecast';

const HOUR = 3_600_000;
const CESANTES = ALL_SPOTS.find((s) => s.id === 'cesantes')!;

function score(over: Record<string, unknown> = {}): SpotScore {
  return {
    spotId: CESANTES.id, spotName: CESANTES.id, verdict: 'light', score: 30, summary: 'Flojo', reason: 'Flojo',
    wind: { stationCount: 8, avgSpeedKt: 7, rawAvgSpeedKt: 7, dominantDir: null, dirDeg: null },
    waves: null, waterTemp: null, airTemp: 14.1, humidity: 80, windChill: null, heatIndex: null, windDirDeg: null,
    hardGateTriggered: null, thermal: null, hasStormAlert: false, thermalBoosted: false, effectiveWindKt: 7,
    scoringConfidence: 'medium', provisional: false, windTrend: null, gustKt: null, dewPoint: 11, humiditySignal: null,
    thetaVGradient: null, computedAt: new Date(), ...over,
  } as unknown as SpotScore;
}

function hours(): HourlyForecast[] {
  const start = Math.floor(Date.now() / HOUR) * HOUR;
  return Array.from({ length: 12 }, (_, i) => ({
    time: new Date(start + i * HOUR), temperature: 14, humidity: 80, windSpeed: 3, windDirection: 45, windGusts: 4,
    precipitation: 0, precipProbability: 0, cloudCover: 60, pressure: 1012, solarRadiation: 0, cape: null,
    boundaryLayerHeight: null, visibility: null, liftedIndex: null, cin: null, snowLevel: null, skyState: null, isDay: true,
  })) as unknown as HourlyForecast[];
}

async function open(simple: boolean, s: SpotScore = score()) {
  useUIStore.setState({ simpleMode: simple, isMobile: false });
  // A steady hour of stored figures: the trend has something to say («estable»)
  const now = Date.now();
  useSpotStore.setState({
    scores: new Map([[s.spotId, s]]), lastScored: now, surfWaveCache: new Map(),
    spotForecasts: new Map([[s.spotId, { data: hours(), fetchedAt: now }]]),
    thermalPrecursors: new Map(),
    windHistory: new Map([[s.spotId, Array.from({ length: 13 }, (_, i) => ({ ts: now - (12 - i) * 7.5 * 60_000, kt: 7 }))]]),
  } as never);
  const view = render(<SpotPopup spot={CESANTES} />);
  // The tide table and the sea temperature land a tick later
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return view;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-11T19:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(h.pending));
  useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! } as never);
  useSpotStore.getState().selectSpot('');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), spotForecasts: new Map(), thermalPrecursors: new Map(), windHistory: new Map() } as never);
});

describe('simple mode: the card keeps what a passer-by reads', () => {
  it('has the verdict, what comes, the place, the next tide alone, the cameras and «Compartir»', async () => {
    const { container } = await open(true);
    const text = container.textContent ?? '';
    expect(text).toContain('Flojo');
    expect(text).toContain('Lo que viene');
    expect(text).toContain('Ver previsión detallada');
    expect(text).toContain('Aire');
    expect(text).toContain('Próxima marea');
    expect(text).toContain('Bajamar 22:54 · 1,0 m');
    expect(text).not.toContain('04:35');
    expect(text).not.toContain('Mareas hoy');
    if (CESANTES.webcams?.length) expect(text).toMatch(/Ver la cámara|Ver las cámaras/);
    expect(screen.getByText('Compartir')).toBeTruthy();
  });

  it('drops what asks of the reader or explains the workings', async () => {
    const { container } = await open(true);
    const text = container.textContent ?? '';
    for (const gone of ['¿Estás aquí ahora?', 'caja de parte', 'Apoyar', 'Cómo lo sabemos', 'Próximas horas', 'Más datos', 'Historial', 'Mejores ventanas', 'estaciones']) {
      expect(text, gone).not.toContain(gone);
    }
    expect(container.querySelector('.gf-credit')).toBeNull();
  });

  it('never drops what can hurt', async () => {
    const { container } = await open(true, score({ hardGateTriggered: 'Rachas de 38 kt: peligro', hasStormAlert: true, scoringConfidence: 'low' }));
    const text = container.textContent ?? '';
    expect(text).toContain('Rachas de 38 kt: peligro');
    expect(text).toContain('Alerta de tormenta activa');
    expect(text).toContain('Poco dato cerca de aquí');
  });
});

describe('advanced mode: nothing was taken away', () => {
  it('keeps the report, the workings, the four tides and the foot', async () => {
    const { container } = await open(false);
    const text = container.textContent ?? '';
    for (const there of ['¿Estás aquí ahora?', 'caja de parte', 'Apoyar', 'Cómo lo sabemos', 'Próximas horas', 'Mareas hoy', '04:35', '8 estaciones']) {
      expect(text, there).toContain(there);
    }
    expect(text).not.toContain('Próxima marea');
  });
});

describe('both modes: the head and the labels', () => {
  it.each([true, false])('no heading: «rumbo variable» and the trend on its own named line (simple=%s)', async (simple) => {
    const { container } = await open(simple);
    const side = container.querySelector('.gf-side')!;
    expect(side.textContent).toContain('nudos · rumbo variable');
    expect(side.textContent).not.toMatch(/variable\s*estable/);
    const line = side.querySelector('.gf-trendline');
    expect(line?.textContent).toBe('viento estable');
  });

  it('with a heading the trend stays beside it, unnamed', async () => {
    const { container } = await open(true, score({ wind: { stationCount: 8, avgSpeedKt: 7, rawAvgSpeedKt: 7, dominantDir: 'NE', dirDeg: 45 }, windDirDeg: 45 }));
    const side = container.querySelector('.gf-side')!;
    expect(side.querySelector('.gf-trendline')).toBeNull();
    expect(side.querySelector('.gf-trend')?.textContent).toBe('estable');
  });

  it.each([true, false])('the water of a model says «modelo», not the model\'s name (simple=%s)', async (simple) => {
    const { container } = await open(simple);
    const labels = [...container.querySelectorAll('.gf-data dt')].map((d) => d.textContent);
    expect(labels).toContain('Agua (modelo)');
    expect(labels.join(' ')).not.toContain('MOHID');
  });
});

describe('review, 18-nov: a cold load and a spot closed by the sea', () => {
  it('opened before the spot has a score (a shared link on a cold load): «Calculando», never «Sin datos», and nothing to share', async () => {
    useUIStore.setState({ simpleMode: true, isMobile: false });
    useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), spotForecasts: new Map(), thermalPrecursors: new Map(), windHistory: new Map() } as never);
    render(<SpotPopup spot={CESANTES} />);
    await act(async () => { await Promise.resolve(); });
    expect(document.body.textContent).toMatch(/Calculando/);
    expect(document.body.textContent).not.toMatch(/Sin datos/i);
    expect(screen.queryByRole('button', { name: /Compartir/ })).toBeNull();
  });

  it('closed by the sea, the shared text says the sea, not the wind verdict with its knots', async () => {
    const share = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, share });
    await open(true, score({ verdict: 'strong', hardGateKind: 'wave', hardGateTriggered: 'Oleaje', effectiveWindKt: 8, waves: { waveHeight: 3, localHeight: 3 } }));
    await act(async () => { screen.getByRole('button', { name: /Compartir/ }).click(); await Promise.resolve(); });
    expect(share).toHaveBeenCalled();
    const text = (share.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(text).toContain('Oleaje · 3,0 m');
    expect(text).not.toMatch(/FUERTE|kt/);
  });
});
