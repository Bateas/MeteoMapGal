/**
 * Contract tests for what the spot card SAYS, case by case in tables (17-nov, plan item C6): the beach a surf spot
 * likes, the UV and air-quality notes, the last hour of light, the spot's caution and «Cómo lo sabemos». They cover
 * breaks the full sweep of 12-nov left alive in SpotPopup.tsx. Each was checked to fail with its break put in.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { useBuoyStore } from '../../store/buoyStore';

const h = vi.hoisted(() => ({ pending: () => new Promise<never>(() => {}), baseline: null as unknown }));

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
vi.mock('../../hooks/useHistoricalBaseline', () => ({ useHistoricalBaseline: () => ({ baseline: h.baseline, loading: false }) }));
vi.mock('../spot/SpotWarningNotice', () => ({ SpotWarningNotice: () => null }));
vi.mock('../spot/WindNowNext', async (orig) => ({ ...(await orig<typeof import('../spot/WindNowNext')>()), WindNowNext: () => null }));
vi.mock('../spot/SpotReportBox', () => ({ SpotReportBox: () => null }));

import { SpotPopup } from './SpotPopup';
import { ALL_SPOTS } from '../../config/spots';
import { SECTORS } from '../../config/sectors';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { useAirQualityStore } from '../../store/airQualityStore';
import { buildSurfEntry } from '../../services/surfVerdictEngine';
import { getSunTimes } from '../../services/solarUtils';
import type { SpotScore } from '../../services/spotScoringEngine';
import type { MarineForecastHour } from '../../api/marineClient';
import type { SailingSpot } from '../../config/spots';

const HOUR = 3_600_000;
const NOW = new Date('2026-07-15T13:00:00Z').getTime();
const VAO = ALL_SPOTS.find((s) => s.id === 'vao')!;
const SURF = ALL_SPOTS.find((s) => s.category === 'surf')!;
const WIND = { stationCount: 3, avgSpeedKt: 6, rawAvgSpeedKt: 6, dominantDir: 'NE', dirDeg: 45 };

function score(spotId: string, over: Record<string, unknown> = {}): SpotScore {
  return {
    spotId, spotName: spotId, verdict: 'sailing', score: 50, summary: 'Navegable', reason: 'Navegable',
    wind: WIND, waves: null, waterTemp: 17, airTemp: 24, humidity: 60, windChill: null, heatIndex: null, windDirDeg: 45,
    hardGateTriggered: null, thermal: null, hasStormAlert: false, thermalBoosted: false, effectiveWindKt: 6,
    scoringConfidence: 'medium', provisional: false, windTrend: null, gustKt: 9, dewPoint: null, humiditySignal: null,
    thetaVGradient: null, computedAt: new Date(), ...over,
  } as unknown as SpotScore;
}

function waveHours(): MarineForecastHour[] {
  return Array.from({ length: 24 }, (_, i) => ({
    time: new Date(NOW + i * HOUR), waveHeight: 1, wavePeriod: 10, waveDirection: 300, swellHeight: 1, swellPeriod: 10, swellDirection: 300,
  }));
}

function seed(spot: SailingSpot, s: SpotScore) {
  useSpotStore.setState({
    scores: new Map([[spot.id, s]]), lastScored: Date.now(),
    surfWaveCache: spot.category === 'surf' ? new Map([[spot.id, buildSurfEntry(spot as never, waveHours(), s, NOW, NOW, false)]]) : new Map(),
    spotForecasts: new Map(), thermalPrecursors: new Map(),
  } as never);
}

const text = () => document.body.textContent ?? '';
/** The note whose text contains `needle`, to read its tone class. */
const note = (needle: string) => [...document.querySelectorAll('.gf-note')].find((n) => n.textContent?.includes(needle)) ?? null;
const open = (title: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }));
const dd = (label: string) => [...document.querySelectorAll('dt')].find((d) => d.textContent === label)?.nextElementSibling?.textContent;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  vi.stubGlobal('fetch', vi.fn(h.pending));
  useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! } as never);
  useUIStore.setState({ simpleMode: false, isMobile: false });
  useAirQualityStore.setState({ data: null });
  useSpotStore.getState().selectSpot('');
});

afterEach(() => {
  cleanup();
  useBuoyStore.setState({ silentBuoys: [] } as never);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useAirQualityStore.setState({ data: null });
  useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), spotForecasts: new Map(), thermalPrecursors: new Map() } as never);
});

describe('what a surf beach likes', () => {
  const beach = (over: Partial<SailingSpot>) => ({ ...SURF, ...over }) as SailingSpot;
  const show = (spot: SailingSpot) => {
    seed(spot, score(spot.id));
    render(<SpotPopup spot={spot} />);
    open('Qué le va a esta playa');
  };

  it.each([
    ['all', 'Todas'], ['mid-high', 'Media-alta'], ['mid', 'Media'], ['low', 'Baja'], ['high', 'Alta'],
  ] as const)('tide %s reads «%s»', (pref, label) => {
    show(beach({ tidePreference: pref }));
    expect(dd('Marea')).toBe(label);
  });

  it('names where it faces and the swell it takes', () => {
    show(beach({ beachOrientation: 315, swellDirections: [315, 270] }));
    expect(dd('Playa')).toBe('NW');
    expect(dd('Swell')).toBe('NW/W');
  });

  it('leaves out what it does not know', () => {
    show(beach({ beachOrientation: undefined, swellDirections: undefined }));
    expect(dd('Playa')).toBeUndefined();
    expect(dd('Swell')).toBeUndefined();
  });
});

describe('UV and air quality', () => {
  const aq = (over: Record<string, number>) => useAirQualityStore.setState({
    data: { uvIndex: 2, pm2_5: 5, europeanAqi: 20, dust: 0, aerosolOpticalDepth: 0.1, fetchedAt: NOW, ...over },
  });
  const show = () => { seed(VAO, score(VAO.id)); render(<SpotPopup spot={VAO} />); };

  it.each([
    [5, null, null],
    [6, 'alto, protección recomendada', 'gc-t-alto'],
    [8, 'muy alto, crema SPF50+', 'gc-t-critico'],
    [11, 'extremo, protección total', 'gc-t-critico'],
  ] as const)('UV %s', (uv, words, tone) => {
    aq({ uvIndex: uv });
    show();
    const n = note(`UV ${uv}`);
    if (words == null) { expect(n).toBeNull(); return; }
    expect(n?.textContent).toContain(words);
    expect(n?.className).toContain(tone);
  });

  it.each([
    [59, null, null],
    [60, 'Calidad del aire: mala', 'gc-t-alto'],
    [80, 'Calidad del aire: muy mala', 'gc-t-critico'],
  ] as const)('air index %s', (aqi, words, tone) => {
    aq({ europeanAqi: aqi });
    show();
    const n = note('Calidad del aire');
    if (words == null) { expect(n).toBeNull(); return; }
    expect(n?.textContent).toContain(words);
    expect(n?.className).toContain(tone);
    expect(n?.textContent).not.toContain('PM2,5');
  });

  it.each([[35, true], [34, false]] as const)('fine particles at %s µg/m³ named: %s', (pm, named) => {
    aq({ europeanAqi: 70, pm2_5: pm });
    show();
    expect(note('Calidad del aire')?.textContent?.includes(`PM2,5 ${pm}`)).toBe(named);
  });
});

describe('the last hour of light', () => {
  it.each([
    [90, null, null],
    [45, 'Quedan 45 min de luz', 'gc-t-alto'],
    [20, 'Quedan 20 min de luz', 'gc-t-critico'],
    [5, 'Quedan 5 min de luz', 'gc-t-critico'],
    [-5, null, null],
  ] as const)('%s min before sunset', (min, words, tone) => {
    const { sunset } = getSunTimes(new Date(NOW), VAO.center);
    vi.setSystemTime(new Date(sunset.getTime() - min * 60_000 - 30_000));
    seed(VAO, score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    const n = note('de luz');
    if (words == null) { expect(n).toBeNull(); return; }
    expect(n?.textContent).toContain(words);
    expect(n?.className).toContain(tone);
  });
});

describe('the caution of a spot', () => {
  it('shows when the spot has one', () => {
    const spot = { ...VAO, caution: 'Rocas a la entrada.' } as SailingSpot;
    seed(spot, score(spot.id));
    render(<SpotPopup spot={spot} />);
    expect(note('Rocas a la entrada.')?.className).toContain('gc-t-alto');
  });

  it('says nothing when it has none', () => {
    const spot = { ...VAO, caution: undefined } as SailingSpot;
    seed(spot, score(spot.id));
    render(<SpotPopup spot={spot} />);
    expect(document.querySelector('.gf-notes--now .gc-t-alto')).toBeNull();
  });
});

describe('the sea of a wind spot', () => {
  const waves = (over: Record<string, unknown>) => ({
    waveHeight: 1.6, wavePeriod: null, localHeight: null, localSource: null, sourceBuoy: 'Silleiro', ...over,
  });
  const show = (w: Record<string, unknown>) => { seed(VAO, score(VAO.id, { waves: waves(w) })); render(<SpotPopup spot={VAO} />); };

  it.each([
    ['swan', 'Ola en la zona (modelo)', '0,8 m'],
    ['estimate', 'Ola en la zona (estimada)', '≈0,8 m'],
  ] as const)('a %s sea of its own is the zone wave, without the open-sea buoy', (src, label, value) => {
    show({ localHeight: 0.8, localSource: src });
    expect(dd(label)).toBe(value);
    expect(dd('Oleaje (Silleiro, mar abierto)')).toBeUndefined();
  });

  it('a sea that is only the buoy shows the buoy, named, and no zone wave', () => {
    show({ localHeight: 0.8, localSource: 'buoy' });
    expect(dd('Oleaje (Silleiro, mar abierto)')).toBe('1,6 m');
    expect(text()).not.toContain('Ola en la zona');
  });

  it('without a sea of its own the buoy is there; without a buoy name it is just «Oleaje»', () => {
    show({});
    expect(dd('Oleaje (Silleiro, mar abierto)')).toBe('1,6 m');
    cleanup();
    show({ sourceBuoy: null });
    expect(dd('Oleaje')).toBe('1,6 m');
  });

  it.each([[9, '9 s'], [null, undefined]] as const)('period %s', (p, value) => {
    show({ wavePeriod: p });
    expect(dd('Período')).toBe(value);
  });
});

describe('the gust in the head of the card', () => {
  it('a gust above the wind is said', () => {
    seed(VAO, score(VAO.id, { gustKt: 14 }));
    render(<SpotPopup spot={VAO} />);
    expect(text()).toContain('racha 14');
  });

  it('no gust, or one not above the wind, says nothing', () => {
    seed(VAO, score(VAO.id, { gustKt: null }));
    render(<SpotPopup spot={VAO} />);
    expect(text()).not.toMatch(/racha \d/);
    cleanup();
    seed(VAO, score(VAO.id, { gustKt: 5 }));
    render(<SpotPopup spot={VAO} />);
    expect(text()).not.toMatch(/racha \d/);
  });

  it('a raised wind does not invent a gust nobody measured', () => {
    seed(VAO, score(VAO.id, { effectiveWindKt: 11, gustKt: null }));
    render(<SpotPopup spot={VAO} />);
    expect(text()).not.toMatch(/racha \d/);
  });
});

describe('the best sailing windows', () => {
  const win = (summary: string, verdict: 'good' | 'marginal') => ({
    start: new Date(NOW), end: new Date(NOW + 3 * HOUR), hours: 3, avgScore: 60, peakScore: 70, avgWindKt: 12,
    dominantDir: 'SW', verdict, summary,
  });
  const show = (spot: SailingSpot, windows: ReturnType<typeof win>[], best: number | null, simple = false) => {
    seed(spot, score(spot.id));
    useSpotStore.setState({
      sailingWindows: new Map([[spot.id, { spotId: spot.id, windows, hourlyScores: [], bestWindow: best == null ? null : windows[best], nextGoodHour: null, fetchedAt: new Date(NOW) }]]),
    } as never);
    useUIStore.setState({ simpleMode: simple });
    render(<SpotPopup spot={spot} />);
  };
  afterEach(() => useSpotStore.setState({ sailingWindows: new Map() } as never));

  it('lists them, marks the best one and colours a good one apart from a fair one', () => {
    show(VAO, [win('14-17h · 12kt SW · Navegable', 'marginal'), win('17-20h · 15kt SW · Bueno', 'good')], 1);
    expect(screen.getByRole('button', { name: /Mejores ventanas/ }).textContent).toContain('(2)');
    open('Mejores ventanas');
    expect(note('17-20h')?.textContent).toContain('La mejor ventana');
    expect(note('17-20h')?.className).toContain('gc-t-ok');
    expect(note('14-17h')?.textContent).not.toContain('La mejor ventana');
    expect(note('14-17h')?.className).toContain('gc-t-moderado');
  });

  it.each([
    ['no window', VAO, [], false],
    ['a surf beach', SURF, [win('14-17h · 12kt SW · Navegable', 'good')], false],
    ['simple mode', VAO, [win('14-17h · 12kt SW · Navegable', 'good')], true],
  ] as const)('nothing for %s', (_, spot, windows, simple) => {
    show(spot, [...windows], windows.length ? 0 : null, simple);
    expect(screen.queryByRole('button', { name: /Mejores ventanas/ })).toBeNull();
  });
});

describe('«Cómo lo sabemos»', () => {
  const show = (spot: SailingSpot, over: Record<string, unknown>) => {
    seed(spot, score(spot.id, over));
    render(<SpotPopup spot={spot} />);
    open('Cómo lo sabemos');
  };

  it('a wind spot names its pattern and the humidity sign', () => {
    show(VAO, { wind: { ...WIND, matchedPattern: 'Nordeste de la ría' }, humiditySignal: 'Humedad subiendo en la costa' });
    expect(text()).toContain('Patrón del sitio: Nordeste de la ría');
    expect(note('Humedad subiendo en la costa')).not.toBeNull();
  });

  it('a surf beach does not name a wind pattern', () => {
    show(SURF, { wind: { ...WIND, matchedPattern: 'Nordeste de la ría' } });
    expect(text()).not.toContain('Patrón del sitio');
  });

  it('without a humidity sign there is no humidity note', () => {
    show(VAO, {});
    expect([...document.querySelectorAll('.gf-note')].some((n) => (n.textContent ?? '').trim() === '')).toBe(false);
  });

  it('says it is the stations, unadjusted, when nothing was raised', () => {
    show(VAO, { effectiveWindKt: 6, gustKt: 9 });
    expect(text()).toContain('Sale de las estaciones cercanas, sin ajuste.');
    expect(text()).not.toContain('Racha medida');
  });

  it('says what was measured and what is estimated when the wind was raised', () => {
    // A 9 kt gust under an estimated 11 kt cannot stand: the card shows 12 (1,1 x the mean) and says what was measured.
    show(VAO, { effectiveWindKt: 11, gustKt: 9 });
    expect(text()).toContain('Las estaciones miden 6 kt; aquí se estiman 11. Racha medida: 9 kt.');
    expect(text()).toContain('racha 12');
  });
});

describe('today against the last 30 days', () => {
  const base = (avg: number, p50: number, p75: number, p90: number) => ({ avg, p50, p75, p90, maxGust: null, hoursSampled: 300 });
  const show = (b: unknown, verdict = 'sailing') => {
    h.baseline = b;
    seed(VAO, score(VAO.id, { verdict }));
    render(<SpotPopup spot={VAO} />);
    open('Cómo lo sabemos');
  };
  afterEach(() => { h.baseline = null; });

  it.each([
    ['top 10 %', base(3, 3, 4, 5), 'top 10%', 'gc-t-ok'],
    ['top 25 %', base(4, 4, 5, 8), 'top 25%', 'gc-t-ok'],
    ['below the usual', base(15, 14, 18, 22), 'flojo vs media 15', 'gc-t-riesgo'],
  ] as const)('%s', (_, b, words, tone) => {
    show(b);
    const n = note('últimos 30 días');
    expect(n?.textContent).toContain(words);
    expect(n?.className).toContain(tone);
  });

  it('a near-usual day that is still notable carries no colour', () => {
    show(base(4.5, 4.5, 7, 9));
    const n = note('últimos 30 días');
    expect(n?.textContent).toContain('+33%');
    expect(n?.className).not.toContain('gc-t-');
  });

  it('a weak verdict is not celebrated as «top», but can be said to be below the usual', () => {
    show(base(3, 3, 4, 5), 'light');
    expect(note('últimos 30 días')).toBeNull();
    cleanup();
    show(base(15, 14, 18, 22), 'light');
    expect(note('últimos 30 días')?.textContent).toContain('flojo');
  });
});

describe('the other temperatures wait behind «Más datos»', () => {
  it('humidity and dew point appear only when asked for', () => {
    seed(VAO, score(VAO.id, { humidity: 61, dewPoint: 12.4 }));
    render(<SpotPopup spot={VAO} />);
    expect(dd('Humedad')).toBeUndefined();
    expect(dd('Punto de rocío')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Más datos' }));
    expect(dd('Humedad')).toBe('61 %');
    expect(dd('Punto de rocío')).toBe('12,4 °C');
  });
});

describe('a surf beach without a wave hour', () => {
  it('says it has no wave data, never the wind verdict', () => {
    useSpotStore.setState({
      scores: new Map([[SURF.id, score(SURF.id)]]), lastScored: Date.now(),
      surfWaveCache: new Map([[SURF.id, buildSurfEntry(SURF as never, waveHours().map((w) => ({ ...w, time: new Date(w.time.getTime() + 6 * HOUR) })), score(SURF.id), NOW, NOW, false)]]),
      spotForecasts: new Map(), thermalPrecursors: new Map(),
    } as never);
    render(<SpotPopup spot={SURF} />);
    expect(text()).toContain('SIN DATO DE OLAS');
  });

  it('a wind spot never says it', () => {
    seed(VAO, score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(text()).not.toContain('SIN DATO DE OLAS');
  });
});

describe('the 24 h wave strip of a surf beach', () => {
  /** One row an hour from `fromH` to `toH` hours from now, with a period and a height per hour. */
  const rows = (fromH: number, toH: number, period: number, height: (i: number) => number): MarineForecastHour[] =>
    Array.from({ length: toH - fromH + 1 }, (_, i) => ({
      time: new Date(NOW + (fromH + i) * HOUR), waveHeight: height(i), wavePeriod: period, waveDirection: 300,
      swellHeight: height(i), swellPeriod: period, swellDirection: 300,
    }));
  const show = (hours: MarineForecastHour[]) => {
    const s = score(SURF.id);
    useSpotStore.setState({
      scores: new Map([[SURF.id, s]]), lastScored: Date.now(),
      surfWaveCache: new Map([[SURF.id, buildSurfEntry(SURF as never, hours, s, NOW, NOW, false)]]),
      spotForecasts: new Map(), thermalPrecursors: new Map(),
    } as never);
    render(<SpotPopup spot={SURF} />);
  };
  const bars = () => [...document.querySelectorAll('.flex-1[title*=" en la playa"]')] as HTMLElement[];

  it('goes from an hour ago to 24 h ahead, nothing older or later', () => {
    show(rows(-4, 30, 10, () => 1));
    expect(bars()).toHaveLength(26);
  });

  it('labels every sixth hour, starting with the first bar', () => {
    show(rows(-4, 30, 10, () => 1));
    const first = bars()[0].title.split(' h:')[0];
    const strip = bars()[0].parentElement!.nextElementSibling!;
    const labels = [...strip.querySelectorAll('span')].map((s) => s.textContent);
    expect(labels).toHaveLength(5);
    expect(labels[0]).toBe(`${first} h`);
  });

  it('outlines the peak of the coming hours, and only it', () => {
    show(rows(-1, 24, 10, (i) => (i === 9 ? 3 : 1)));
    const outlined = bars().filter((b) => b.style.outline !== '');
    expect(outlined).toHaveLength(1);
    expect(outlined[0]).toBe(bars()[9]);
  });

  it.each([[11, 'largo (buena calidad)'], [8, 'medio'], [5, 'corto (mar de viento)']] as const)('a %s s period reads «%s»', (p, words) => {
    show(rows(-1, 24, p, () => 1));
    expect(text()).toContain(`Periodo ${words}`);
  });
});

describe('the shape in the head of the card', () => {
  const chip = () => document.querySelector('svg.gf-chip polygon') as SVGPolygonElement;

  it('a wind spot fills it with its state and draws a plain rule', () => {
    seed(VAO, score(VAO.id));
    render(<SpotPopup spot={VAO} />);
    expect(chip().getAttribute('fill')).not.toBe('none');
    expect(chip().getAttribute('fill')).not.toBe('var(--g-hair)');
    expect(chip().getAttribute('stroke')).toBe('var(--g-rule)');
  });

  it('a surf beach with its wave is hollow, drawn in the colour of the wave', () => {
    seed(SURF, score(SURF.id));
    render(<SpotPopup spot={SURF} />);
    expect(chip().getAttribute('fill')).toBe('none');
    expect(chip().getAttribute('stroke')).not.toBe('var(--g-rule)');
  });

  it('a surf beach without a wave hour is empty', () => {
    const s = score(SURF.id);
    useSpotStore.setState({
      scores: new Map([[SURF.id, s]]), lastScored: Date.now(),
      surfWaveCache: new Map([[SURF.id, buildSurfEntry(SURF as never, waveHours().map((w) => ({ ...w, time: new Date(w.time.getTime() + 6 * HOUR) })), s, NOW, NOW, false)]]),
      spotForecasts: new Map(), thermalPrecursors: new Map(),
    } as never);
    render(<SpotPopup spot={SURF} />);
    expect(chip().getAttribute('fill')).toBe('var(--g-hair)');
    expect(chip().getAttribute('stroke')).toBe('var(--g-rule)');
  });
});

describe('a buoy the spot leans on went silent (Ons, 17-nov 18:10)', () => {
  const LANZADA = ALL_SPOTS.find((s) => s.id === 'lanzada')!;
  const silent = (stationId: number, stationName: string, ms: number) =>
    ({ stationId, stationName, timestamp: new Date(ms).toISOString(), source: 'portus' }) as never;

  it('the card says which one and since when; a silent buoy it does not use is not named', () => {
    expect(LANZADA.preferredBuoys).toContain(4272);
    useBuoyStore.setState({ silentBuoys: [silent(4272, 'Ons', new Date(NOW).getTime() - 6 * 3_600_000), silent(1251, 'Rande (Ría Vigo)', new Date(NOW).getTime() - 6 * 86_400_000)] } as never);
    seed(LANZADA, score(LANZADA.id));
    render(<SpotPopup spot={LANZADA} />);
    expect(note('Ons: sin dato desde')).not.toBeNull();
    expect(text()).not.toContain('Rande');
  });

  it('a buoy silent less than three hours is not named yet', () => {
    useBuoyStore.setState({ silentBuoys: [silent(4272, 'Ons', new Date(NOW).getTime() - 60 * 60_000)] } as never);
    seed(LANZADA, score(LANZADA.id));
    render(<SpotPopup spot={LANZADA} />);
    expect(note('Ons: sin dato')).toBeNull();
  });
});

describe('the line under the state, with the colour held between two levels (P3 review, 19-nov)', () => {
  const light = (kt: number) => score(VAO.id, {
    verdict: 'light', summary: 'Flojo', reason: 'Insuficiente para navegar.', effectiveWindKt: kt,
    wind: { ...WIND, avgSpeedKt: kt, rawAvgSpeedKt: kt },
  });

  it('held between Flojo and Navegable: the doubt, not «Insuficiente para navegar»', () => {
    seed(VAO, light(7.8));
    render(<SpotPopup spot={VAO} />);
    expect(text()).toMatch(/entre Flojo y Navegable/);
    expect(text()).not.toMatch(/Insuficiente para navegar/);
  });

  it('clearly Flojo: the line is said', () => {
    seed(VAO, light(6.4));
    render(<SpotPopup spot={VAO} />);
    expect(text()).not.toMatch(/entre Flojo/);
    expect(text()).toMatch(/Insuficiente para navegar/);
  });
});
