/**
 * ConditionsTicker smoke tests — ensures the component renders
 * without crashing with various store states.
 *
 * These tests exist because a wrong Zustand selector (s.readings vs s.currentReadings)
 * crashed the entire app in production (v1.21.0). See learnings.md.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConditionsTicker } from './ConditionsTicker';
import { useWeatherStore } from '../../store/weatherStore';
import { useBuoyStore } from '../../store/buoyStore';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useWarningsStore } from '../../hooks/useWarnings';
import { SECTORS } from '../../config/sectors';
import type { MGWarning } from '../../api/mgWarningsClient';
import type { SpotScore } from '../../services/spotScoringEngine';
import { ALL_SPOTS } from '../../config/spots';
import { buildSurfEntry, type SurfWaveEntry } from '../../services/surfVerdictEngine';
import { useThemeStore } from '../../store/themeStore';

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
        startTime: new Date(),
        endTime: new Date(Date.now() + 6 * 3600_000),
        comment: '',
      },
    ],
    publishedAt: new Date(),
    link: 'https://www.meteogalicia.gal',
  };
}

/** Fully-typed SpotScore fixture (real interface from spotScoringEngine).
 *  Object.assign (not object spread) — spreading Partial<T> over T widens
 *  every property to `T[K] | undefined`, which fails the SpotScore return. */
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

describe('ConditionsTicker', () => {
  beforeEach(() => {
    // Reset stores to initial state
    useWeatherStore.setState({
      stations: [],
      currentReadings: new Map(),
    });
    useBuoyStore.setState({
      buoys: [],
    });
    useSpotStore.setState({
      scores: new Map(),
      surfWaveCache: new Map(),
    });
    useWarningsStore.setState({
      sectorWarnings: [],
    });
    useSectorStore.setState({
      activeSectorId: 'embalse',
      activeSector: SECTORS.find((s) => s.id === 'embalse')!,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    useThemeStore.setState({ theme: 'dark' });
  });

  it('renders without crashing with empty stores', () => {
    // This is the critical test — the v1.21.0 crash happened because
    // wrong store selectors returned undefined, causing TypeError
    const { container } = render(<ConditionsTicker />);
    // With no data, ticker returns null (no items to show)
    expect(container.innerHTML).toBe('');
  });

  it('renders without crashing with station data but no scores', () => {
    useWeatherStore.setState({
      stations: [
        { id: 'test_1', name: 'Test Station', source: 'aemet', lat: 42.3, lon: -8.7, altitude: 100 } as any,
      ],
      currentReadings: new Map([
        ['test_1', { temperature: 15, windSpeed: 5, windGust: 8, windDirection: 180 } as any],
      ]),
    });

    const { container } = render(<ConditionsTicker />);
    // Should render gust + temperature items even without spot scores
    expect(container.innerHTML).not.toBe('');
    expect(screen.getAllByText(/Racha máx/).length).toBeGreaterThan(0);
  });

  it('renders without crashing with buoy data', () => {
    useBuoyStore.setState({
      buoys: [
        { stationId: 1, stationName: 'Boya Cíes', waveHeight: 1.5, waterTemp: 14 } as any,
      ],
    });

    useWeatherStore.setState({
      stations: [
        { id: 'test_1', name: 'Test', source: 'mg', lat: 42.3, lon: -8.7, altitude: 50 } as any,
      ],
      currentReadings: new Map([
        ['test_1', { temperature: 18, windSpeed: 2, windGust: 4 } as any],
      ]),
    });

    const { container } = render(<ConditionsTicker />);
    expect(container.innerHTML).not.toBe('');
    expect(screen.getAllByText(/Olas.*1\.5m/).length).toBeGreaterThan(0);
  });

  it('shows station count and last update when no wind/scores data', () => {
    useWeatherStore.setState({
      stations: [
        { id: 's1', name: 'A', source: 'aemet', lat: 42, lon: -8, altitude: 100 } as any,
        { id: 's2', name: 'B', source: 'mg', lat: 42, lon: -8, altitude: 200 } as any,
      ],
      currentReadings: new Map([
        ['s1', { temperature: 12 } as any],
        ['s2', { temperature: 14 } as any],
      ]),
    });

    const { container } = render(<ConditionsTicker />);
    // With stations but no significant wind/temp range, should show station count
    expect(container.innerHTML).not.toBe('');
    expect(screen.getAllByText(/2 estaciones/).length).toBeGreaterThan(0);
  });

  // ── simpleMode (prop simple) ─────────────────────────────────
  // The ticker mounts ALWAYS; in simple mode it filters to critical items
  // only. A casual user must never miss an official MG warning.

  it('simple=true: official MG warning strip stays visible', () => {
    useWarningsStore.setState({ sectorWarnings: [makeWarning(2)] });

    render(<ConditionsTicker simple />);
    // Static strip renders once (not duplicated like the marquee)
    expect(screen.getByText(/Aviso NARANJA/)).toBeTruthy();
    expect(screen.getByText('Vento')).toBeTruthy();
  });

  it('simple=true: beach headline visible, informational items hidden', () => {
    // Fake Date only (real timers stay) — 12:00Z is daytime (8-21h local)
    // in both UTC (CI) and CEST (dev machine), timezone-safe per gotcha.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z'));

    // Coastal sector so the beach-day branch runs
    useSectorStore.setState({
      activeSectorId: 'rias',
      activeSector: SECTORS.find((s) => s.id === 'rias')!,
    });
    // Beach spot (cesantes ∈ BEACH_SPOT_IDS) with enough signals for an
    // ok/great verdict: air 24°C + wind 8kt + water 18°C
    useSpotStore.setState({
      scores: new Map<string, SpotScore>([['cesantes', makeScore()]]),
    });
    // Informational source present: gust station would show "Racha máx"
    useWeatherStore.setState({
      stations: [
        { id: 'test_1', name: 'Test Station', source: 'aemet', lat: 42.3, lon: -8.7, altitude: 100 } as any,
      ],
      currentReadings: new Map([
        ['test_1', { temperature: 22, windSpeed: 5, windGust: 8, windDirection: 180, timestamp: new Date() } as any],
      ]),
    });

    render(<ConditionsTicker simple />);
    // Beach headline survives the simple filter (marquee duplicates items)
    expect(screen.getAllByText(/¿Playa\?/).length).toBeGreaterThan(0);
    // Informational items do NOT: gusts + spot verdict filtered out
    expect(screen.queryByText(/Racha máx/)).toBeNull();
    expect(screen.queryByText(/Cesantes:/)).toBeNull();
  });

  it('simple=true: with no critical items renders nothing', () => {
    // Informational-only data (gust + fallback station count in full mode)
    useWeatherStore.setState({
      stations: [
        { id: 'test_1', name: 'Test Station', source: 'aemet', lat: 42.3, lon: -8.7, altitude: 100 } as any,
      ],
      currentReadings: new Map([
        ['test_1', { temperature: 15, windSpeed: 5, windGust: 8, windDirection: 180 } as any],
      ]),
    });

    const { container } = render(<ConditionsTicker simple />);
    // No official warnings + no critical items → silence by default
    expect(container.innerHTML).toBe('');
  });

  it('simple absent (full mode): informational items still show', () => {
    useWeatherStore.setState({
      stations: [
        { id: 'test_1', name: 'Test Station', source: 'aemet', lat: 42.3, lon: -8.7, altitude: 100 } as any,
      ],
      currentReadings: new Map([
        ['test_1', { temperature: 15, windSpeed: 5, windGust: 8, windDirection: 180 } as any],
      ]),
    });

    render(<ConditionsTicker />);
    expect(screen.getAllByText(/Racha máx/).length).toBeGreaterThan(0);
  });
  // ── Surf (the cache entry every surface reads) ──────────────
  // The best surf spot from SURF OK up is essential, so simple mode — the
  // default for new visitors — shows it; the height is a model value and the
  // text says so. Anything below SURF OK stays in full mode only. «The best»
  // is CLÁSICO, then SURF OK, then GRANDE; never by night, never with a storm
  // alert, never over the engine's hard gate.

  interface SurfCase { h: number; dir: number; wind: number; kt?: number; hardGate?: string; storm?: boolean }

  /** Clock at a LOCAL hour (the ticker reads getHours()), only Date faked. */
  function atLocalHour(hour: number) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 27, hour, 0, 0));
  }

  function surfSetup(entries: [string, SurfCase][], hour = 12) {
    atLocalHour(hour);
    useSectorStore.setState({
      activeSectorId: 'rias',
      activeSector: SECTORS.find((s) => s.id === 'rias')!,
    });
    const hourMs = 3_600_000;
    const start = Math.floor(Date.now() / hourMs) * hourMs - hourMs;
    const scores = new Map<string, SpotScore>();
    const cache = new Map<string, SurfWaveEntry>();
    for (const [id, { h, dir, wind, kt = 8, hardGate, storm = false }] of entries) {
      const spot = ALL_SPOTS.find((s) => s.id === id)!;
      const sc = makeScore({
        spotId: id as SpotScore['spotId'],
        verdict: hardGate ? 'strong' : 'calm',
        hardGateTriggered: hardGate ?? null,
        hasStormAlert: storm,
        effectiveWindKt: kt,
      });
      sc.wind = { ...sc.wind!, dirDeg: wind, avgSpeedKt: kt };
      scores.set(id, sc);
      const hours = Array.from({ length: 6 }, (_, i) => ({
        time: new Date(start + i * hourMs),
        waveHeight: h, wavePeriod: 8, waveDirection: dir,
        swellHeight: h, swellPeriod: 8, swellDirection: dir,
      }));
      cache.set(id, buildSurfEntry(spot, hours, sc, Date.now(), Date.now()));
    }
    useSpotStore.setState({ scores, surfWaveCache: cache });
    return cache;
  }

  // Corrubedo 1.3 m NW × 0.88 = 1.14 m → SURF OK; wind NE 60 is neutral there.
  const CORRUBEDO_OK: [string, SurfCase] = ['surf-corrubedo', { h: 1.3, dir: 315, wind: 60 }];

  it('simple=true: the best surf spot from SURF OK up shows, marked as model', () => {
    // Patos 0.9 m × 0.45 = 0.4 m → PEQUE, stays out of simple mode.
    const cache = surfSetup([CORRUBEDO_OK, ['surf-patos', { h: 0.9, dir: 315, wind: 60 }]]);
    expect(cache.get('surf-corrubedo')!.verdict?.label).toBe('SURF OK');
    expect(cache.get('surf-patos')!.verdict?.label).toBe('PEQUE');

    render(<ConditionsTicker simple />);
    expect(screen.getAllByText('Corrubedo: SURF OK ~1,1 m (modelo)').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Patos:/)).toBeNull();
  });

  it('simple=true: only ONE surf spot is essential, the biggest of the best level', () => {
    surfSetup([CORRUBEDO_OK, ['surf-lanzada', { h: 1.9, dir: 270, wind: 180 }]]);
    // Lanzada 1.9 × 0.75 = 1.43 m SURF OK (wind S, neutral there) beats
    // Corrubedo 1.14 m SURF OK
    render(<ConditionsTicker simple />);
    expect(screen.getAllByText(/Lanzada Surf: SURF OK/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Corrubedo:/)).toBeNull();
  });

  it('simple=true: CLÁSICO is «the best», not a bigger GRANDE', () => {
    // Corrubedo 3.0 × 0.88 = 2.64 m → GRANDE; Lanzada 2.4 × 0.75 = 1.8 m → CLÁSICO
    const cache = surfSetup([
      ['surf-corrubedo', { h: 3.0, dir: 315, wind: 60 }],
      ['surf-lanzada', { h: 2.4, dir: 270, wind: 180 }],
    ]);
    expect(cache.get('surf-corrubedo')!.verdict?.label).toBe('GRANDE');
    expect(cache.get('surf-lanzada')!.verdict?.label).toBe('CLÁSICO');
    render(<ConditionsTicker simple />);
    expect(screen.getAllByText(/Lanzada Surf: CLÁSICO/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Corrubedo:/)).toBeNull();
  });

  it('simple=true: GRANDE still shows when it is the only one from SURF OK up', () => {
    surfSetup([['surf-corrubedo', { h: 3.0, dir: 315, wind: 60 }]]);
    render(<ConditionsTicker simple />);
    expect(screen.getAllByText(/Corrubedo: GRANDE ~2,6 m \(modelo\)/).length).toBeGreaterThan(0);
  });

  it('a beach over the engine hard gate is never essential; full mode reads its wind verdict', () => {
    const gated: [string, SurfCase] = ['surf-corrubedo', { h: 1.3, dir: 315, wind: 315, kt: 30, hardGate: 'Viento 30kt > 25kt' }];
    surfSetup([gated]);
    const { unmount } = render(<ConditionsTicker simple />);
    expect(screen.queryByText(/Corrubedo:/)).toBeNull();
    unmount();

    surfSetup([gated]);
    render(<ConditionsTicker />);
    expect(screen.getAllByText(/Corrubedo: Fuerte/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Corrubedo: (SURF OK|PEQUE|FLAT|CLÁSICO|GRANDE)/)).toBeNull();
  });

  it('simple=true: no surf promotion with a storm alert on (full mode still lists it)', () => {
    const stormy: [string, SurfCase] = ['surf-corrubedo', { h: 1.3, dir: 315, wind: 60, storm: true }];
    surfSetup([stormy]);
    const { unmount } = render(<ConditionsTicker simple />);
    expect(screen.queryByText(/Corrubedo:/)).toBeNull();
    unmount();
    surfSetup([stormy]);
    render(<ConditionsTicker />);
    expect(screen.getAllByText(/Corrubedo: SURF OK/).length).toBeGreaterThan(0);
  });

  it('simple=true: no surf promotion at night (full mode still lists it)', () => {
    surfSetup([CORRUBEDO_OK], 2);
    const { unmount } = render(<ConditionsTicker simple />);
    expect(screen.queryByText(/Corrubedo:/)).toBeNull();
    unmount();
    surfSetup([CORRUBEDO_OK], 2);
    render(<ConditionsTicker />);
    expect(screen.getAllByText(/Corrubedo: SURF OK/).length).toBeGreaterThan(0);
  });

  it('surf items take the level colour of the theme (the ticker is light in light mode)', () => {
    const cache = surfSetup([CORRUBEDO_OK]);
    const v = cache.get('surf-corrubedo')!.verdict!;
    const hexToRgb = (hex: string) => {
      const [r, g, b] = (hex.replace('#', '').match(/../g) ?? []).map((x) => parseInt(x, 16));
      return `rgb(${r}, ${g}, ${b})`;
    };
    const { unmount } = render(<ConditionsTicker simple />);
    expect(screen.getAllByText('Corrubedo: SURF OK ~1,1 m (modelo)')[0].parentElement!.style.color).toBe(hexToRgb(v.text));
    unmount();
    useThemeStore.setState({ theme: 'light' });
    render(<ConditionsTicker simple />);
    expect(screen.getAllByText('Corrubedo: SURF OK ~1,1 m (modelo)')[0].parentElement!.style.color).toBe(hexToRgb(v.lightText));
  });

  it('full mode: every surf spot shows, PEQUE included', () => {
    surfSetup([CORRUBEDO_OK, ['surf-patos', { h: 0.9, dir: 315, wind: 60 }]]);
    render(<ConditionsTicker />);
    expect(screen.getAllByText(/Corrubedo: SURF OK/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Patos: PEQUE ~0,4 m (modelo)').length).toBeGreaterThan(0);
  });

  it('surf stays quiet while its wind is pending', () => {
    useSectorStore.setState({
      activeSectorId: 'rias',
      activeSector: SECTORS.find((s) => s.id === 'rias')!,
    });
    const spot = ALL_SPOTS.find((s) => s.id === 'surf-corrubedo')!;
    const t = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    const hours = [0, 1, 2].map((i) => ({
      time: new Date(t + i * 3_600_000),
      waveHeight: 1.3, wavePeriod: 8, waveDirection: 315, swellHeight: 1.3, swellPeriod: 8, swellDirection: 315,
    }));
    useSpotStore.setState({
      scores: new Map(),
      surfWaveCache: new Map([['surf-corrubedo', buildSurfEntry(spot, hours, undefined, Date.now(), Date.now())]]),
    });
    render(<ConditionsTicker />);
    expect(screen.queryByText(/Corrubedo:/)).toBeNull();
  });
});
