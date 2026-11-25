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
import { useBuoyData } from '../../hooks/useBuoyData';
import { useSpotScoring } from '../../hooks/useSpotScoring';
import { useSpotTrendSeed } from '../../hooks/useSpotTrendSeed';
import { useUserSpotScoring } from '../../hooks/useUserSpotScoring';
import { useSailingWindows } from '../../hooks/useSailingWindows';
import { useWebcamVision } from '../../hooks/useWebcamVision';
import { useAirQuality } from '../../hooks/useAirQuality';
import { useActiveFires } from '../../hooks/useActiveFires';
import { useIcaData } from '../../hooks/useIcaData';
// Hooks previously running directly in WeatherMap /
// AppShell, now deferred 3s like the rest. They write to stores so consumer
// components (overlays, popups) read via subscriptions and stay reactive.
import { useSurfMarineData } from '../../hooks/useSurfMarineData';
import { useWebcamVisionData } from '../../hooks/useWebcamVisionData';
import { useForecastTimeline } from '../../hooks/useForecastTimeline';
import { useMetarVisibility } from '../../hooks/useMetarVisibility';
import { useObserverGreeting } from '../../hooks/useObserver';
import { fetchTeleconnections, type TeleconnectionIndex } from '../../api/naoClient';
import { useWeatherStore } from '../../store/weatherStore';

export function DeferredHooks({ teleconnectionsRef }: { teleconnectionsRef: React.MutableRefObject<TeleconnectionIndex[]> }) {
  useThermalAnalysis();
  useLightningData();
  useStormShadow();
  useWarnings();
  useBuoyData();
  useSpotScoring();
  useSpotTrendSeed();
  useObserverGreeting();
  useUserSpotScoring();
  useSailingWindows();
  useWebcamVision();
  useAirQuality();
  useActiveFires();
  useIcaData();
  useSurfMarineData();
  useWebcamVisionData();
  useForecastTimeline();
  useMetarVisibility();

  // NAO/AO teleconnection indices — 15s extra after deferred mount
  useEffect(() => {
    const t = setTimeout(() => {
      fetchTeleconnections()
        .then((data) => { teleconnectionsRef.current = data; })
        .catch(() => { /* graceful degradation — alerts work without */ });
    }, 15_000);
    return () => clearTimeout(t);
  }, [teleconnectionsRef]);

  // Prune stale reading history every 30min. Moved here (from
  // AppShell) to keep it off the initial mount critical path. Runs 3s after
  // deferred mount and then every 30min — first prune is at deferred+30min,
  // acceptable since history starts empty anyway.
  const pruneHistory = useWeatherStore((s) => s.pruneHistory);
  useEffect(() => {
    const id = setInterval(() => {
      pruneHistory();
    }, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [pruneHistory]);

  return null;
}
