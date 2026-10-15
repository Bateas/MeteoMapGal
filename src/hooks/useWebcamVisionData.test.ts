/**
 * Camera readings from the API: only night is dropped. The model's Beaufort decides nothing:
 * in dense fog it cannot see the water and reports -1, and the map used to throw that fog away
 * (15-oct 17:15-18:25, Cíes faro norte: 5 of its 9 readings).
 */
import { describe, it, expect } from 'vitest';
import { visionFromRows, type VisionRow } from './useWebcamVisionData';
import { isUsableVision } from '../services/webcamFogSites';

const row = (over: Partial<VisionRow>): VisionRow => ({
  webcam_id: 'mg-ciesfaro-norte', spot_id: null, beaufort: 1, confidence: 'medium',
  fog: false, visibility: 'good', sky: 'clear', description: '', provider: 'moondream',
  latency_ms: 900, time: '2026-10-15T15:45:00Z', ...over,
});

describe('visionFromRows', () => {
  it('keeps a daytime fog reading whose Beaufort is -1', () => {
    const { results } = visionFromRows([row({ beaufort: -1, fog: true, visibility: 'poor', sky: 'fog' })]);
    expect(results.get('mg-ciesfaro-norte')?.weather.fogVisible).toBe(true);
  });

  it('drops night readings', () => {
    const { results } = visionFromRows([row({ beaufort: -1, sky: 'night' })]);
    expect(results.size).toBe(0);
  });

  it('a daytime -1 without fog still counts as a camera that sees clear', () => {
    const { results } = visionFromRows([row({ beaufort: -1, sky: 'overcast' })]);
    expect(results.get('mg-ciesfaro-norte')?.weather.fogVisible).toBe(false);
  });
});

describe('isUsableVision', () => {
  it('is false only at night', () => {
    expect(isUsableVision('night')).toBe(false);
    for (const s of ['clear', 'fog', 'overcast', 'unknown', 'rain']) expect(isUsableVision(s)).toBe(true);
  });
});
