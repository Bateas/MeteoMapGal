/**
 * useSectorAnalytics — fetches 3 sector-level analytics endpoints in parallel.
 *
 * Used by SectorSummaryPanel inside HistoryDashboard (T2-7 Phase 4). Each
 * endpoint is independent (Promise.allSettled) so a 5xx on one doesn't take
 * down the others. Cache is server-side (5min - 1h); this hook just owns
 * the in-flight state for a single tab session.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  fetchLightningHeatmap,
  fetchConvectionTrend,
  fetchAirQualityTrend,
  type LightningHeatmapResponse,
  type ConvectionTrendResponse,
  type AirQualityTrendResponse,
} from '../api/analyticsClient';

interface SectorAnalyticsState {
  lightning: LightningHeatmapResponse | null;
  convection: ConvectionTrendResponse | null;
  airQuality: AirQualityTrendResponse | null;
  /** Per-endpoint loading flags */
  loading: {
    lightning: boolean;
    convection: boolean;
    airQuality: boolean;
  };
  /** Per-endpoint error strings (null if OK) */
  errors: {
    lightning: string | null;
    convection: string | null;
    airQuality: string | null;
  };
  refetch: () => void;
}

export function useSectorAnalytics(
  sector: 'embalse' | 'rias',
  days: number = 30,
): SectorAnalyticsState {
  const [lightning, setLightning] = useState<LightningHeatmapResponse | null>(null);
  const [convection, setConvection] = useState<ConvectionTrendResponse | null>(null);
  const [airQuality, setAirQuality] = useState<AirQualityTrendResponse | null>(null);

  const [loadingLightning, setLoadingLightning] = useState(false);
  const [loadingConvection, setLoadingConvection] = useState(false);
  const [loadingAirQuality, setLoadingAirQuality] = useState(false);

  const [errorLightning, setErrorLightning] = useState<string | null>(null);
  const [errorConvection, setErrorConvection] = useState<string | null>(null);
  const [errorAirQuality, setErrorAirQuality] = useState<string | null>(null);

  const refetch = useCallback(() => {
    let cancelled = false;

    setLoadingLightning(true);
    setErrorLightning(null);
    fetchLightningHeatmap({ days })
      .then((res) => { if (!cancelled) setLightning(res); })
      .catch((err) => { if (!cancelled) setErrorLightning((err as Error).message); })
      .finally(() => { if (!cancelled) setLoadingLightning(false); });

    setLoadingConvection(true);
    setErrorConvection(null);
    fetchConvectionTrend({ sector, days })
      .then((res) => { if (!cancelled) setConvection(res); })
      .catch((err) => { if (!cancelled) setErrorConvection((err as Error).message); })
      .finally(() => { if (!cancelled) setLoadingConvection(false); });

    setLoadingAirQuality(true);
    setErrorAirQuality(null);
    fetchAirQualityTrend({ days })
      .then((res) => { if (!cancelled) setAirQuality(res); })
      .catch((err) => { if (!cancelled) setErrorAirQuality((err as Error).message); })
      .finally(() => { if (!cancelled) setLoadingAirQuality(false); });

    return () => { cancelled = true; };
  }, [sector, days]);

  useEffect(() => {
    const cleanup = refetch();
    return cleanup;
  }, [refetch]);

  return {
    lightning,
    convection,
    airQuality,
    loading: {
      lightning: loadingLightning,
      convection: loadingConvection,
      airQuality: loadingAirQuality,
    },
    errors: {
      lightning: errorLightning,
      convection: errorConvection,
      airQuality: errorAirQuality,
    },
    refetch,
  };
}
