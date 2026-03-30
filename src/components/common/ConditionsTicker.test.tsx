/**
 * ConditionsTicker smoke tests — ensures the component renders
 * without crashing with various store states.
 *
 * These tests exist because a wrong Zustand selector (s.readings vs s.currentReadings)
 * crashed the entire app in production (v1.21.0). See learnings.md.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConditionsTicker } from './ConditionsTicker';
import { useWeatherStore } from '../../store/weatherStore';
import { useBuoyStore } from '../../store/buoyStore';
import { useSpotStore } from '../../store/spotStore';

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
});
