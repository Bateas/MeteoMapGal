/**
 * Hook for webcam vision analysis — Beaufort estimation via LLM.
 *
 * Development mode: Uses LM Studio on localhost:1234.
 * Only analyzes webcams with type='image' (direct image URL).
 *
 * Polling: every 15 minutes (visibility-aware).
 * Disabled by default — enable via `VITE_VISION_ENABLED=true`.
 */
import { useEffect, useRef, useCallback } from 'react';
import { useSpotStore } from '../store/spotStore';
import { useSectorStore } from '../store/sectorStore';
import { getSpotsForSector } from '../config/spots';
import {
  analyzeAllSpotWebcams,
  getVisionProvider,
  setVisionProvider,
  VISION_PROVIDERS,
  type VisionProviderConfig,
} from '../services/webcamVisionService';
import { useVisibilityPolling } from './useVisibilityPolling';

/** Polling interval: 15 minutes */
const VISION_POLL_MS = 15 * 60 * 1000;

/** Minimum time between analyses (debounce) */
const MIN_INTERVAL_MS = 5 * 60 * 1000;

export function useWebcamVision() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const setWebcamVision = useSpotStore((s) => s.setWebcamVision);
  const lastRunRef = useRef(0);
  const runningRef = useRef(false);

  // Check if vision is enabled (dev feature flag)
  const isEnabled = import.meta.env.VITE_VISION_ENABLED === 'true';

  // Configure provider from env
  useEffect(() => {
    if (!isEnabled) return;

    const providerId = import.meta.env.VITE_VISION_PROVIDER || 'lmstudio';
    const preset = VISION_PROVIDERS[providerId];
    if (preset) {
      const config: VisionProviderConfig = { ...preset };

      // Override from env if provided
      if (import.meta.env.VITE_VISION_BASE_URL) {
        config.baseUrl = import.meta.env.VITE_VISION_BASE_URL;
      }
      if (import.meta.env.VITE_VISION_MODEL) {
        config.model = import.meta.env.VITE_VISION_MODEL;
      }
      if (import.meta.env.VITE_VISION_API_KEY) {
        config.apiKey = import.meta.env.VITE_VISION_API_KEY;
      }

      setVisionProvider(config);
      console.log(`[WebcamVision] Provider: ${config.id} (${config.baseUrl}/${config.model})`);
    }
  }, [isEnabled]);

  const runAnalysis = useCallback(async () => {
    if (!isEnabled || runningRef.current) return;

    const now = Date.now();
    if (now - lastRunRef.current < MIN_INTERVAL_MS) return;

    const spots = getSpotsForSector(sectorId);
    const hasImageWebcams = spots.some(s =>
      s.webcams?.some(w => w.type === 'image'),
    );

    if (!hasImageWebcams) return;

    runningRef.current = true;
    lastRunRef.current = now;

    try {
      const provider = getVisionProvider();
      console.log(`[WebcamVision] Analyzing webcams for sector ${sectorId} via ${provider.id}...`);

      const results = await analyzeAllSpotWebcams(spots, provider);

      if (results.size > 0) {
        setWebcamVision(results);
        for (const [spotId, result] of results) {
          const w = result.weather;
          console.log(
            `[WebcamVision] ${spotId}: Beaufort ${result.beaufort} (${result.beaufortLabel}) ` +
            `~${result.windEstimateKt}kt · ${result.confidence} · ${result.latencyMs}ms\n` +
            `  Wind: ${result.description}\n` +
            `  Weather: ${w.sky} · vis:${w.visibility} · precip:${w.precipitation} · fog:${w.fogVisible}` +
            (w.cloudType ? ` · clouds:${w.cloudType}` : '') +
            (w.weatherDescription ? `\n  ${w.weatherDescription}` : ''),
          );
        }
      }
    } catch (error) {
      console.warn('[WebcamVision] Analysis failed:', error);
    } finally {
      runningRef.current = false;
    }
  }, [isEnabled, sectorId, setWebcamVision]);

  // Visibility-aware polling
  useVisibilityPolling(runAnalysis, VISION_POLL_MS, isEnabled);

  // Initial run on mount (delayed 10s to let stations load first)
  useEffect(() => {
    if (!isEnabled) return;
    const timer = setTimeout(runAnalysis, 10_000);
    return () => clearTimeout(timer);
  }, [isEnabled, runAnalysis]);
}
