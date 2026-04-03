/**
 * useWebcamVisionData — polls ingestor API for webcam vision analysis results.
 *
 * Reads from /api/v1/webcam-vision (served by ingestor, backed by Ollama).
 * Updates webcamStore.visionResults so popups can display Beaufort + weather data.
 * Falls back gracefully if ingestor API is unavailable.
 */

import { useCallback } from 'react';
import { useWebcamStore } from '../store/webcamStore';
import { useSpotStore } from '../store/spotStore';
import { useVisibilityPolling } from './useVisibilityPolling';
import { RIAS_WEBCAMS } from '../config/webcams';
import type { WebcamVisionResult } from '../services/webcamVisionService';

const POLL_INTERVAL_MS = 5 * 60_000; // 5 min
const API_URL = '/api/v1/webcam-vision?hours=3';

/** Map API row to WebcamVisionResult */
function rowToResult(row: {
  webcam_id: string; spot_id: string | null; beaufort: number;
  confidence: string; fog: boolean; visibility: string; sky: string;
  description: string; provider: string; latency_ms: number; time: string;
}): WebcamVisionResult {
  return {
    spotId: row.spot_id ?? row.webcam_id,
    beaufort: row.beaufort,
    beaufortLabel: beaufortLabel(row.beaufort),
    windEstimateKt: beaufortToKt(row.beaufort),
    confidence: (row.confidence as 'high' | 'medium' | 'low') || 'low',
    description: row.description || '',
    weather: {
      sky: row.sky as WebcamVisionResult['weather']['sky'] || 'unknown',
      visibility: row.visibility as 'good' | 'moderate' | 'poor' || 'moderate',
      precipitation: false,
      fogVisible: row.fog,
      cloudTypes: [],
      seaState: '',
      lightCondition: 'bright',
      weatherDescription: row.description || '',
    },
    rawResponse: '',
    imageUrl: '',
    analyzedAt: new Date(row.time),
    providerUsed: row.provider || 'moondream',
    latencyMs: row.latency_ms || 0,
  };
}

function beaufortLabel(bf: number): string {
  const labels = ['Calma', 'Ventolina', 'Flojito', 'Flojo', 'Moderado', 'Fresquito', 'Fresco', 'Frescachon'];
  return bf >= 0 && bf <= 7 ? labels[bf] : 'Desconocido';
}

function beaufortToKt(bf: number): number {
  const midpoints = [0, 2, 5, 9, 13, 19, 24, 30];
  return bf >= 0 && bf <= 7 ? midpoints[bf] : 0;
}

export function useWebcamVisionData() {
  const setVisionResults = useWebcamStore((s) => s.setVisionResults);
  const setWebcamVision = useSpotStore((s) => s.setWebcamVision);

  const fetchVision = useCallback(async () => {
    try {
      const res = await fetch(API_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return;
      const data = await res.json() as { readings: Array<Parameters<typeof rowToResult>[0]> };
      if (!data.readings || data.readings.length === 0) return;

      const results = new Map<string, WebcamVisionResult>();
      const spotVision = new Map<string, WebcamVisionResult>();

      for (const row of data.readings) {
        if (row.beaufort < 0) continue; // Skip night/unknown
        const result = rowToResult(row);
        results.set(row.webcam_id, result);

        // Also map to nearest spot for SpotPopup WebcamVisionBadge
        const webcam = RIAS_WEBCAMS.find(w => w.id === row.webcam_id);
        const spotId = webcam?.nearestSpotId ?? row.spot_id;
        if (spotId) {
          const existing = spotVision.get(spotId);
          // Keep highest confidence / most recent per spot
          if (!existing || result.confidence === 'high' || result.analyzedAt > existing.analyzedAt) {
            spotVision.set(spotId, result);
          }
        }
      }

      if (results.size > 0) {
        setVisionResults(results);
      }
      if (spotVision.size > 0) {
        setWebcamVision(spotVision);
      }
    } catch {
      // Ingestor API unavailable — silent fail, frontend works without vision
    }
  }, [setVisionResults, setWebcamVision]);

  useVisibilityPolling(fetchVision, POLL_INTERVAL_MS, true, 12_000); // Stagger: 12s after page load
}
