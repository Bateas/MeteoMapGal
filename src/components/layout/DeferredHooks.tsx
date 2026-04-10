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
import { useSailingWindows } from '../../hooks/useSailingWindows';
import { useWebcamVision } from '../../hooks/useWebcamVision';
import { fetchTeleconnections, type TeleconnectionIndex } from '../../api/naoClient';

export function DeferredHooks({ teleconnectionsRef }: { teleconnectionsRef: React.MutableRefObject<TeleconnectionIndex[]> }) {
  useThermalAnalysis();
  useLightningData();
  useStormShadow();
  useWarnings();
  useAirspace();
  useBuoyData();
  useSpotScoring();
  useSailingWindows();
  useWebcamVision();

  // NAO/AO teleconnection indices — 15s extra after deferred mount
  useEffect(() => {
    const t = setTimeout(() => {
      fetchTeleconnections()
        .then((data) => { teleconnectionsRef.current = data; })
        .catch(() => { /* graceful degradation — alerts work without */ });
    }, 15_000);
    return () => clearTimeout(t);
  }, [teleconnectionsRef]);

  return null;
}
