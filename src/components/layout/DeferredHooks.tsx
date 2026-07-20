/**
 * Non-critical hooks deferred 3s after mount to unblock LCP.
 * All write to Zustand stores — AppShell reads from stores, not return values.
 * Extracted as a lazy component so its imports (spotScoringEngine, thermalPrecursorService, etc.)
 * are code-split into a separate chunk.
 */
import { useEffect } from 'react';
import { useThermalAnalysis } from '../../hooks/useThermalAnalysis';
import { useLightningData } from '../../hooks/useLightningData';
import { useStormShadow } from '../../hooks/useStormShadow';
import { useWarnings } from '../../hooks/useWarnings';
import { useAirspace } from '../../hooks/useAirspace';
import { useBuoyData } from '../../hooks/useBuoyData';
import { useSpotScoring } from '../../hooks/useSpotScoring';
import { useUserSpotScoring } from '../../hooks/useUserSpotScoring';
import { useSailingWindows } from '../../hooks/useSailingWindows';
import { useWebcamVision } from '../../hooks/useWebcamVision';
import { useAirQuality } from '../../hooks/useAirQuality';
import { useActiveFires } from '../../hooks/useActiveFires';
import { useIcaData } from '../../hooks/useIcaData';
// Audit S136+3 #7+#8: hooks previously running directly in WeatherMap /
// AppShell, now deferred 3s like the rest. They write to stores so consumer
// components (overlays, popups) read via subscriptions and stay reactive.
import { useAviationData } from '../../hooks/useAviationData';
import { useSurfMarineData } from '../../hooks/useSurfMarineData';
import { useWebcamVisionData } from '../../hooks/useWebcamVisionData';
import { useForecastTimeline } from '../../hooks/useForecastTimeline';
import { useMetarVisibility } from '../../hooks/useMetarVisibility';
import { fetchTeleconnections, type TeleconnectionIndex } from '../../api/naoClient';
import { useWeatherStore } from '../../store/weatherStore';
import { useAlertStore } from '../../store/alertStore';

export function DeferredHooks({ teleconnectionsRef }: { teleconnectionsRef: React.MutableRefObject<TeleconnectionIndex[]> }) {
  useThermalAnalysis();
  useLightningData();
  useStormShadow();
  useWarnings();
  useAirspace();
  useBuoyData();
  useSpotScoring();
  useUserSpotScoring();
  useSailingWindows();
  useWebcamVision();
  useAirQuality();
  useActiveFires();
  useIcaData();
  useAviationData();
  useSurfMarineData();
  useWebcamVisionData();
  useForecastTimeline();
  useMetarVisibility();
  // Convection risk overlay (CAPE × LI) is NO LONGER auto-activated
  // (audit — user feedback): the model-based prediction can
  // contradict live radar/lightning (green zones with active red strikes,
  // 30-60 min model staleness vs sub-15-min storm dynamics). Casual users
  // lose trust when reality and prediction disagree visually. The manual
  // toggle lives in MapStyleSelector → ATMÓSFERA for power users that want
  // a "where COULD storms form in next 6 h" overview.

  // NAO/AO teleconnection indices — 15s extra after deferred mount
  useEffect(() => {
    const t = setTimeout(() => {
      fetchTeleconnections()
        .then((data) => { teleconnectionsRef.current = data; })
        .catch(() => { /* graceful degradation — alerts work without */ });
    }, 15_000);
    return () => clearTimeout(t);
  }, [teleconnectionsRef]);

  // Prune stale reading history + alert history every 30min. Moved here (from
  // AppShell) to keep it off the initial mount critical path. Runs 3s after
  // deferred mount and then every 30min — first prune is at deferred+30min,
  // acceptable since history starts empty anyway.
  const pruneHistory = useWeatherStore((s) => s.pruneHistory);
  const pruneAlertHistory = useAlertStore((s) => s.pruneAlertHistory);
  useEffect(() => {
    const id = setInterval(() => {
      pruneHistory();
      pruneAlertHistory();
    }, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [pruneHistory, pruneAlertHistory]);

  return null;
}
