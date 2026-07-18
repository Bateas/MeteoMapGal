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
});
