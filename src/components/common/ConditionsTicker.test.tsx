/**
 * ConditionsTicker: official warnings plus one fixed line. Smoke tests included because a wrong
 * Zustand selector (s.readings vs s.currentReadings) crashed the entire app in production (v1.21.0).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConditionsTicker } from './ConditionsTicker';
import { useWeatherStore } from '../../store/weatherStore';
import { useBuoyStore } from '../../store/buoyStore';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useWarningsStore } from '../../hooks/useWarnings';
import { useLightningStore } from '../../hooks/useLightningData';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { useAirQualityStore } from '../../store/airQualityStore';
import { useIcaStore } from '../../store/icaStore';
import { useAlertStore } from '../../store/alertStore';
import { useFireStore } from '../../store/fireStore';
import { SECTORS } from '../../config/sectors';
import type { MGWarning } from '../../api/mgWarningsClient';
import type { SpotScore } from '../../services/spotScoringEngine';
import type { HourlyForecast } from '../../types/forecast';
import type { AirQualityCurrent } from '../../api/airQualityClient';
import type { MeteoTide } from '../../services/meteoTideService';

const tide = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../hooks/useMeteoTide', () => ({ useMeteoTide: (station?: string) => (station ? tide.value : null) }));

/** Fully-typed MGWarning fixture (real interface from mgWarningsClient). */
function makeWarning(maxLevel: number): MGWarning {
  return {
    type: 'Vento',
    typeId: 3,
    maxLevel,
    zones: [
      {
        name: 'Rías Baixas de Pontevedra',
        id: 336,
        level: maxLevel,
        startTime: new Date(2026, 6, 18, 14, 0),
        endTime: new Date(2026, 6, 18, 20, 0),
        comment: '',
      },
    ],
    publishedAt: new Date(),
    link: 'https://www.meteogalicia.gal',
  };
}

/** Object.assign (not object spread): spreading Partial<T> widens every property to T | undefined. */
function makeScore(partial: Partial<SpotScore> = {}): SpotScore {
  const base: SpotScore = {
    spotId: 'cesantes',
    spotName: 'Praia de Cesantes',
    verdict: 'sailing',
    score: 60,
    summary: 'Navegable',
    wind: {
      stationCount: 3,
      avgSpeedKt: 8,
      rawAvgSpeedKt: 8,
      dominantDir: 'SW',
      dirDeg: 225,
      matchedPattern: null,
      contributions: [],
    },
    waves: null,
    waterTemp: 18,
    airTemp: 24,
    humidity: 60,
    windChill: null,
    heatIndex: null,
    windDirDeg: 225,
    hardGateTriggered: null,
    hardGateKind: null,
    thermal: null,
    hasStormAlert: false,
    thermalBoosted: false,
    effectiveWindKt: 8,
    scoringConfidence: 'medium',
    windTrend: null,
    gustKt: null,
    dewPoint: null,
    humiditySignal: null,
    thetaVGradient: null,
    provisional: false,
    computedAt: new Date(),
  };
  return Object.assign(base, partial);
}

function useRias() {
  useSectorStore.setState({
    activeSectorId: 'rias',
    activeSector: SECTORS.find((s) => s.id === 'rias')!,
  });
}

/** A local hour, only Date faked. */
function atLocalHour(hour: number, month = 6) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, month, 18, hour, 0, 0));
}

function airQuality(over: Partial<AirQualityCurrent> = {}): AirQualityCurrent {
  return { uvIndex: 2, pm2_5: 5, europeanAqi: 10, dust: 0, aerosolOpticalDepth: 0.05, fetchedAt: Date.now(), ...over };
}

const rainyHours = (from: Date, n: number) => Array.from({ length: n }, (_, i) => ({
  time: new Date(from.getTime() + i * 3_600_000),
  precipitation: 3,
  precipProbability: 80,
} as HourlyForecast));

describe('ConditionsTicker', () => {
  beforeEach(() => {
    useWeatherStore.setState({ stations: [], currentReadings: new Map() });
    useBuoyStore.setState({ buoys: [] });
    useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map() });
    useWarningsStore.setState({ sectorWarnings: [] });
    useForecastStore.setState({ hourly: [], convectionData: [] });
    useAirQualityStore.setState({ data: null });
    useIcaStore.setState({ readings: [] });
    useAlertStore.setState({ alerts: [] });
    useFireStore.setState({ fires: [] });
    useLightningStore.setState({ strikes: [], lastFetch: null, stormAlert: { ...useLightningStore.getState().stormAlert, level: 'none' } });
    tide.value = null;
    useSectorStore.setState({
      activeSectorId: 'embalse',
      activeSector: SECTORS.find((s) => s.id === 'embalse')!,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing with empty stores: never «N estaciones activas» as filler', () => {
    useWeatherStore.setState({
      stations: [{ id: 's1', name: 'A', source: 'aemet', lat: 42, lon: -8, altitude: 100 } as never],
      currentReadings: new Map([['s1', { temperature: 12, windSpeed: 5, windGust: 12 } as never]]),
    });
    const { container } = render(<ConditionsTicker />);
    expect(container.innerHTML).toBe('');
  });

  // Lightning is said as measured (distance of the nearest strike, age of the last one), in simple
  // mode too. The storm percentage and the arrival minutes were removed: against the strikes that
  // followed a whole season of logged predictions, neither held up. Strikes far from every spot:
  // nearer ones raise the safety band, and then the line is silent because the band speaks.
  it('lightning: distance and age of the last strike, no percentage and no arrival time', () => {
    const [lon, lat] = SECTORS.find((s) => s.id === 'embalse')!.center;
    const strike = (km: number, minAgo: number, id: number) => ({
      id, lat: lat + km / 111.2, lon, timestamp: Date.now() - minAgo * 60_000,
      peakCurrent: 20, cloudToCloud: false, multiplicity: 1, ageMinutes: minAgo,
    });
    useLightningStore.setState({
      strikes: [strike(48, 4, 1), strike(52, 9, 2), strike(55, 15, 3)],
      lastFetch: new Date(),
      stormAlert: { ...useLightningStore.getState().stormAlert, level: 'watch', nearestKm: 48, recentCount: 3, etaMinutes: 25, trend: 'approaching' },
    });

    const { container } = render(<ConditionsTicker simple />);
    expect(screen.getAllByText('Rayos a 48 km · último hace 4 min').length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/%|ETA|INMINENTE|probable/i);
  });

  it('official warnings stay in simple mode, with the day and the hour', () => {
    atLocalHour(10);
    useWarningsStore.setState({ sectorWarnings: [makeWarning(2)] });
    render(<ConditionsTicker simple />);
    expect(screen.getByText(/Aviso NARANJA/)).toBeTruthy();
    expect(screen.getByText('Viento')).toBeTruthy();
    expect(screen.getByText(/hoy de 14 a 20 h · Rías Baixas de Pontevedra/)).toBeTruthy();
  });

  it('shows one line that does not move, not a marquee', () => {
    atLocalHour(13);
    useRias();
    useSpotStore.setState({ scores: new Map([['cesantes', makeScore()]]) });
    useAirQualityStore.setState({ data: airQuality({ uvIndex: 9 }) });
    useForecastStore.setState({ hourly: rainyHours(new Date(), 4), convectionData: [] });
    const { container } = render(<ConditionsTicker />);
    expect(container.querySelector('.ticker-scroll')).toBeNull();
    expect(container.querySelector('[role="marquee"]')).toBeNull();
    expect(container.querySelectorAll('.gc-tickerline')).toHaveLength(1);
  });

  it('the messages that were cut do not come back', () => {
    atLocalHour(13);
    useRias();
    useSpotStore.setState({ scores: new Map([['cesantes', makeScore({ verdict: 'good' })]]) });
    useBuoyStore.setState({ buoys: [{ stationId: 1, stationName: 'Boya Cíes', waveHeight: 1.5, waterTemp: 13.5 } as never] });
    useWeatherStore.setState({
      stations: [{ id: 't1', name: 'Test Station', source: 'aemet', lat: 42.3, lon: -8.7, altitude: 100 } as never],
      currentReadings: new Map([['t1', { temperature: 22, windSpeed: 5, windGust: 12, timestamp: new Date() } as never]]),
    });
    const { container } = render(<ConditionsTicker />);
    const text = container.textContent ?? '';
    for (const gone of [/Racha máx/, /Olas/, /Afloramiento/, /Calamar/, /Pesca/, /Precursor/, /Brisa marina/, /Datos parciales/, /estaciones activas/, /Cesantes:/]) {
      expect(text).not.toMatch(gone);
    }
  });

  it('beach headline by day with the air measured', () => {
    atLocalHour(13);
    useRias();
    useSpotStore.setState({ scores: new Map([['cesantes', makeScore()]]) });
    render(<ConditionsTicker simple />);
    expect(screen.getByText(/¿Playa\?/)).toBeTruthy();
  });

  it('no beach at night', () => {
    atLocalHour(23);
    useRias();
    useSpotStore.setState({ scores: new Map([['cesantes', makeScore()]]) });
    const { container } = render(<ConditionsTicker simple />);
    expect(container.textContent).not.toMatch(/Playa/);
  });

  it('no beach without the air: the cold gate cannot act (4-nov, «Sol» at 8,7 °C)', () => {
    atLocalHour(13);
    useRias();
    useSpotStore.setState({ scores: new Map([['cesantes', makeScore({ airTemp: null })]]) });
    const { container } = render(<ConditionsTicker simple />);
    expect(container.textContent).not.toMatch(/Playa/);
  });

  it('no beach while the score is provisional', () => {
    atLocalHour(13);
    useRias();
    useSpotStore.setState({ scores: new Map([['cesantes', makeScore({ provisional: true })]]) });
    const { container } = render(<ConditionsTicker simple />);
    expect(container.textContent).not.toMatch(/Playa/);
  });

  it('the line goes silent under the safety band, the official warnings do not', () => {
    atLocalHour(13);
    useRias();
    useSpotStore.setState({ scores: new Map([['cesantes', makeScore()]]) });
    useWarningsStore.setState({ sectorWarnings: [makeWarning(1)] });
    useAlertStore.setState({
      alerts: [{ id: 'storm-main', category: 'storm', severity: 'critical', score: 95, icon: 'zap', title: 'PELIGRO', detail: '', urgent: true, updatedAt: new Date() }],
    });
    const { container } = render(<ConditionsTicker />);
    expect(container.querySelector('.gc-tickerline')).toBeNull();
    expect(screen.getByText(/Aviso AMARILLO/)).toBeTruthy();
  });

  it('air quality: names the station and its distance, only if it is near the sector', () => {
    const reading = { station: 'Coia', ica: 3, dominantPollutant: 'O3', categoryEs: 'Deficiente', color: '#f00', timestamp: new Date() };
    atLocalHour(10);
    useRias();
    const center = SECTORS.find((s) => s.id === 'rias')!.center;
    useIcaStore.setState({ readings: [{ ...reading, lat: center[1] + 0.05, lon: center[0] }] });
    const { unmount } = render(<ConditionsTicker />);
    expect(screen.getByText(/Calidad del aire deficiente en Coia, a \d+ km/)).toBeTruthy();
    unmount();
    // Lugo is not news in Vigo
    useIcaStore.setState({ readings: [{ ...reading, station: 'Lugo', lat: 43.0, lon: -7.55 }] });
    const { container } = render(<ConditionsTicker />);
    expect(container.textContent).not.toMatch(/Lugo/);
  });

  it('the meteorological tide only when strong, measured and named; the routine tide lives in Condiciones', () => {
    atLocalHour(10);
    useRias();
    const reading: MeteoTide = { residualM: 0.3, astronomicalM: 2, observedM: 2.3, level: 'notable', ageMin: 30, gaugeName: 'Vigo' };
    tide.value = { ...reading, residualM: 0.1, level: 'none' };
    const first = render(<ConditionsTicker />);
    expect(first.container.textContent).toBe('');
    first.unmount();
    tide.value = reading;
    const { container } = render(<ConditionsTicker />);
    expect(screen.getByText('Marea 30 cm más alta de lo previsto en Vigo (mareógrafo)')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Pleamar|Bajamar|coef/);
  });

  it('with a spot card open that shows the tide, the strip never repeats it, high level included', async () => {
    const { useSpotStore } = await import('../../store/spotStore');
    atLocalHour(10);
    useRias();
    const reading: MeteoTide = { residualM: 0.3, astronomicalM: 2, observedM: 2.3, level: 'notable', ageMin: 30, gaugeName: 'Vigo' };
    for (const t of [reading, { ...reading, residualM: 0.6, level: 'high' as const }]) {
      tide.value = t;
      useSpotStore.setState({ activeSpotId: 'cesantes' });
      const open = render(<ConditionsTicker />);
      expect(open.container.textContent).not.toMatch(/más alta de lo previsto/);
      open.unmount();
      // A card with no tide block (a user pin has no tide station): the strip is the only voice
      useSpotStore.setState({ activeSpotId: 'user-1' });
      const pin = render(<ConditionsTicker />);
      expect(pin.container.textContent).toMatch(/más alta de lo previsto en Vigo/);
      pin.unmount();
    }
    useSpotStore.setState({ activeSpotId: '' });
  });

  it('a fire names the zone, it is not «a 14 km al este» of an unnamed centre', () => {
    atLocalHour(10);
    useRias();
    const center = SECTORS.find((s) => s.id === 'rias')!.center;
    useFireStore.setState({
      fires: [{ id: 'f1', lat: center[1], lon: center[0] + 0.1, brightness: 345, frp: 30, acquiredAt: new Date(Date.now() - 3_600_000), satellite: 'N', confidence: 'high', daynight: 'D' } as never],
    });
    render(<ConditionsTicker />);
    expect(screen.getByText(/^Incendio en Pontevedra, a \d+ km · hace 1 h$/)).toBeTruthy();
  });

  it('forecast rain speaks in the words of the list and says it is the model', () => {
    atLocalHour(10);
    useRias();
    useForecastStore.setState({ hourly: rainyHours(new Date(2026, 6, 18, 14), 3), convectionData: [] });
    render(<ConditionsTicker />);
    expect(screen.getByText(/Lluvia moderada hoy de 14 a 17 h \(modelo\)/)).toBeTruthy();
  });

  it('never gives a storm arrival time', () => {
    atLocalHour(10);
    useForecastStore.setState({
      convectionData: Array.from({ length: 3 }, (_, i) => ({
        time: new Date(2026, 6, 18, 15 + i), cape: 800, liftedIndex: -4, cin: 10,
      } as HourlyForecast)),
      hourly: [],
    });
    const { container } = render(<ConditionsTicker />);
    expect(container.textContent).not.toMatch(/ETA|~\d+ ?min/);
  });
});

describe('official warnings: one line for the same level, hours and places', () => {
  it('joins the kinds in words', async () => {
    const { joinWarningTypes } = await import('./ConditionsTicker');
    expect(joinWarningTypes('Precipitación 12 horas', 'Precipitación 1 hora')).toBe('Precipitación 12 horas y 1 hora');
    expect(joinWarningTypes('Vento', 'Chuvia')).toBe('Vento, Chuvia');
  });

  it('two of the same level and span are one alert; another level keeps its own', () => {
    const a = makeWarning(1); a.type = 'Precipitación 12 horas'; a.typeId = 10;
    const b = makeWarning(1); b.type = 'Precipitación 1 hora'; b.typeId = 11;
    const c = makeWarning(2); c.type = 'Vento'; c.typeId = 3;
    useWarningsStore.setState({ sectorWarnings: [a, b, c] });
    const { container } = render(<ConditionsTicker />);
    const lines = [...container.querySelectorAll('.gc-official')].map((l) => l.querySelector('b')!.textContent);
    expect(lines).toEqual(['Precipitación 12 horas y 1 hora', 'Viento']);
    expect(container.querySelectorAll('[data-level="2"]').length).toBe(1);
    useWarningsStore.setState({ sectorWarnings: [] });
  });
});

describe('simple mode: two entries at most over the map', () => {
  it('three warnings: the two gravest, and the rest named as waiting in Condiciones', async () => {
    const { useLevelZeroStore } = await import('../../store/levelZeroStore');
    const a = makeWarning(1); a.type = 'Choiva'; a.typeId = 10;
    const b = makeWarning(2); b.type = 'Vento'; b.typeId = 3;
    const c = makeWarning(1); c.type = 'Neve'; c.typeId = 5; c.zones = c.zones.map((z) => ({ ...z, name: 'Montaña de Lugo' }));
    useWarningsStore.setState({ sectorWarnings: [a, b, c] });
    const { container, unmount } = render(<ConditionsTicker simple />);
    const shown = [...container.querySelectorAll('.gc-official')];
    expect(shown.length).toBe(2);
    // the orange one first, whatever the order they came in
    expect(shown[0].querySelector('[data-level="2"]')).toBeTruthy();
    expect(shown[1].textContent).toContain('y 1 más en Condiciones');
    expect(container.querySelector('.gc-tickerline')).toBeNull();
    expect(useLevelZeroStore.getState().tickerKey).toBeNull();
    unmount();
    // advanced still draws the three
    const adv = render(<ConditionsTicker />);
    expect(adv.container.querySelectorAll('.gc-official').length).toBe(3);
    expect(adv.container.textContent).not.toContain('en Condiciones');
    adv.unmount();
    useWarningsStore.setState({ sectorWarnings: [] });
  });
});
