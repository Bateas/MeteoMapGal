/**
 * Tests for shareImageGenerator pure helpers.
 *
 * The canvas rendering side (renderShareCanvas) is not tested here —
 * jsdom has limited canvas support and the visual layout is best
 * validated manually. We focus on the data extractor + utilities
 * that drive the card content.
 */
import { describe, it, expect } from 'vitest';
import {
  buildShareData,
  buildShareFilename,
  buildShareText,
} from './shareImageGenerator';
import type { SpotScore } from './spotScoringEngine';
import type { SailingSpot } from '../config/spots';

// ── Fixtures ────────────────────────────────────────────────

const SPOT_CESANTES: SailingSpot = {
  id: 'cesantes',
  name: 'Cesantes',
  center: [-8.619, 42.307],
  category: 'sailing',
  radiusKm: 12,
  preferredStations: ['mg_10119'],
  icon: 'sailboat',
  thermalDetection: true,
};

const SCORE_BASE: SpotScore = {
  spotId: 'cesantes',
  spotName: 'Cesantes',
  verdict: 'sailing',
  score: 65,
  summary: 'Buen viento SW',
  wind: {
    avgSpeedKt: 12,
    maxGustKt: 18,
    dir: 220,
    confidence: 'high',
    sources: [],
  } as never,
  waves: null,
  waterTemp: 16,
  airTemp: 19,
  humidity: 65,
  windChill: null,
  heatIndex: null,
  windDirDeg: 220,
  hardGateTriggered: null,
  thermal: null,
  hasStormAlert: false,
  thermalBoosted: false,
  effectiveWindKt: 12,
  scoringConfidence: 'high',
  windTrend: null,
} as unknown as SpotScore;

// ── buildShareData ──────────────────────────────────────────

describe('buildShareData', () => {
  it('maps spot + score into card data with verdict label', () => {
    const data = buildShareData(SPOT_CESANTES, SCORE_BASE, { sectorId: 'rias' });
    expect(data.spotName).toBe('Cesantes');
    expect(data.sectorLabel).toBe('Rias Baixas');
    expect(data.verdict).toBe('sailing');
    expect(data.verdictLabel).toBe('Navegable');
    expect(data.verdictColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('rounds windKt to integer and uses effective wind when available', () => {
    const data = buildShareData(SPOT_CESANTES, { ...SCORE_BASE, effectiveWindKt: 14.6 } as SpotScore);
    expect(data.windKt).toBe(15);
  });

  it('falls back to wind.avgSpeedKt when effectiveWindKt is null', () => {
    const data = buildShareData(SPOT_CESANTES, { ...SCORE_BASE, effectiveWindKt: null } as SpotScore);
    expect(data.windKt).toBe(12);
  });

  it('maps windDirDeg to cardinal direction', () => {
    expect(buildShareData(SPOT_CESANTES, { ...SCORE_BASE, windDirDeg: 220 } as SpotScore).windDirCardinal).toBe('SW');
    expect(buildShareData(SPOT_CESANTES, { ...SCORE_BASE, windDirDeg: 0 } as SpotScore).windDirCardinal).toBe('N');
    expect(buildShareData(SPOT_CESANTES, { ...SCORE_BASE, windDirDeg: 90 } as SpotScore).windDirCardinal).toBe('E');
  });

  it('returns null cardinal for missing/invalid direction', () => {
    expect(buildShareData(SPOT_CESANTES, { ...SCORE_BASE, windDirDeg: null } as SpotScore).windDirCardinal).toBeNull();
    expect(buildShareData(SPOT_CESANTES, { ...SCORE_BASE, windDirDeg: NaN } as SpotScore).windDirCardinal).toBeNull();
  });

  it('uses Embalse label for embalse sector', () => {
    const data = buildShareData(SPOT_CESANTES, SCORE_BASE, { sectorId: 'embalse' });
    expect(data.sectorLabel).toBe('Embalse de Castrelo');
  });

  it('rounds temps to 1 decimal', () => {
    const data = buildShareData(SPOT_CESANTES, { ...SCORE_BASE, airTemp: 19.456, waterTemp: 16.789 } as SpotScore);
    expect(data.airTempC).toBe(19.5);
    expect(data.waterTempC).toBe(16.8);
  });

  it('includes wave summary when provided', () => {
    const data = buildShareData(SPOT_CESANTES, SCORE_BASE, { sectorId: 'rias', waveSummary: '0.8m 8s SW' });
    expect(data.waveSummary).toBe('0.8m 8s SW');
  });

  it('null wave summary when not provided', () => {
    const data = buildShareData(SPOT_CESANTES, SCORE_BASE, { sectorId: 'rias' });
    expect(data.waveSummary).toBeNull();
  });
});

// ── buildShareFilename ──────────────────────────────────────

describe('buildShareFilename', () => {
  it('builds slug-date filename', () => {
    const when = new Date('2026-05-27T17:30:00Z');
    const filename = buildShareFilename('Cesantes', when);
    expect(filename).toMatch(/^cesantes-\d{8}-\d{4}\.png$/);
  });

  it('slugifies accents and spaces', () => {
    const when = new Date('2026-05-27T17:30:00Z');
    const filename = buildShareFilename('A Lanzada Surf', when);
    expect(filename).toMatch(/^a-lanzada-surf-/);
  });

  it('falls back to spot when name slug is empty', () => {
    const when = new Date('2026-05-27T17:30:00Z');
    const filename = buildShareFilename('!!!', when);
    expect(filename).toMatch(/^spot-/);
  });
});

// ── buildShareText ──────────────────────────────────────────

describe('buildShareText', () => {
  it('produces caption with verdict and url', () => {
    const data = buildShareData(SPOT_CESANTES, SCORE_BASE, { sectorId: 'rias' });
    const text = buildShareText(data);
    expect(text).toContain('Cesantes');
    expect(text).toContain('Navegable');
    expect(text).toContain('12kt');
    expect(text).toContain('https://meteomapgal.navia3d.com');
  });

  it('omits wind segment when not available', () => {
    const data = buildShareData(SPOT_CESANTES, { ...SCORE_BASE, effectiveWindKt: null, wind: null } as SpotScore);
    const text = buildShareText(data);
    expect(text).toContain('Cesantes');
    expect(text).not.toContain('kt');
  });

  it('includes waveSummary when present', () => {
    const data = buildShareData(SPOT_CESANTES, SCORE_BASE, { sectorId: 'rias', waveSummary: '1.2m' });
    const text = buildShareText(data);
    expect(text).toContain('olas 1.2m');
  });
});
