/**
 * 6-oct: tabs just opened showed, and logged, 30 % in the Embalse next to 88-98 % from the
 * others, with the forecast and the MeteoGalicia warning still empty. The prediction now waits
 * for the lightning, the forecast and the warnings to answer once.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStormPrediction, usePredictionInputsReady } from './useStormPrediction';
import { useLightningStore } from './useLightningData';
import { useForecastStore } from './useForecastTimeline';
import { useWarningsStore } from './useWarnings';

const DANGER = {
  level: 'danger' as const, nearestKm: 4, recentCount: 40, trend: 'stationary' as const,
  etaMinutes: null, speedKmh: null, bearingDeg: null, clusters: [], updatedAt: new Date(),
};

beforeEach(() => {
  useLightningStore.setState({ lastFetch: null, stormAlert: DANGER, recentActivity: { count30m: 40, count15m: 20, count5m: 5 } });
  useForecastStore.setState({ fetchedAt: null, error: null, hourly: [], convectionData: [] });
  useWarningsStore.setState({ lastFetch: null, sectorWarnings: [] });
});

describe('useStormPrediction readiness', () => {
  it('no prediction while the forecast and the warnings have not answered', () => {
    useLightningStore.setState({ lastFetch: new Date() });
    expect(renderHook(() => usePredictionInputsReady()).result.current).toBe(false);
    expect(renderHook(() => useStormPrediction()).result.current.probability).toBe(0);
  });

  it('computed once all three have answered (a failed forecast counts)', () => {
    useLightningStore.setState({ lastFetch: new Date() });
    useForecastStore.setState({ error: 'Open-Meteo 429' });
    useWarningsStore.setState({ lastFetch: new Date() });
    expect(renderHook(() => usePredictionInputsReady()).result.current).toBe(true);
    expect(renderHook(() => useStormPrediction()).result.current.probability).toBeGreaterThan(0);
  });

  it('not before the first lightning answer either', () => {
    useForecastStore.setState({ fetchedAt: new Date() });
    useWarningsStore.setState({ lastFetch: new Date() });
    expect(renderHook(() => usePredictionInputsReady()).result.current).toBe(false);
  });
});
