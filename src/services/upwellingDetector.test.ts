import { describe, it, expect } from 'vitest';
import { classifyWaterMass } from './upwellingDetector';

const JUL = Date.parse('2026-07-15T12:00:00Z');
const NOV = Date.parse('2026-11-09T12:00:00Z');

describe('upwellingDetector', () => {
  describe('classifyWaterMass', () => {
    it('returns unknown when both temp and salinity are null', () => {
      const res = classifyWaterMass(null, null);
      expect(res.type).toBe('unknown');
    });

    it('classifies cold water (<= 14.5°C) with oceanic salinity as ACNA upwelling', () => {
      const res = classifyWaterMass(14.0, null, JUL);
      expect(res.type).toBe('acna');
      expect(res.badgeText).toContain('Afloramiento ACNA');
    });

    it('in November the same water is just the sea in November, never upwelling', () => {
      const res = classifyWaterMass(14.1, 35.4, NOV);
      expect(res.type).toBe('transitional');
      expect(res.badgeText).not.toContain('Afloramiento');
      expect(res.description).not.toContain('Afloramiento');
    });

    it('classifies water <= 14.8°C with high oceanic salinity (>= 34.5 PSU) as ACNA', () => {
      const res = classifyWaterMass(14.8, 35.6, JUL);
      expect(res.type).toBe('acna');
    });

    it('classifies cold water with low salinity (< 33.0 PSU) as estuarine/fluvial, NEVER ACNA', () => {
      const res = classifyWaterMass(13.8, 25.3);
      expect(res.type).toBe('fluvial');
      expect(res.badgeText).toContain('Estuario');
    });

    it('classifies low salinity (< 33.0 PSU) as estuarine/fluvial water', () => {
      const res = classifyWaterMass(16.0, 28.5);
      expect(res.type).toBe('fluvial');
      expect(res.badgeText).toContain('Estuario');
    });

    it('classifies physical sensor glitches (< 10.5°C) as anomaly', () => {
      const res = classifyWaterMass(8.4, 25.3);
      expect(res.type).toBe('anomaly');
      expect(res.badgeText).toContain('Sensor en revisión');
    });

    it('classifies warm water (>= 17.0°C) as warm surface water', () => {
      const res = classifyWaterMass(18.2, 35.4);
      expect(res.type).toBe('surface_warm');
      expect(res.badgeText).toContain('Superficial');
    });

    it('classifies intermediate conditions as transitional coastal water', () => {
      const res = classifyWaterMass(15.8, 34.8);
      expect(res.type).toBe('transitional');
      expect(res.badgeText).toContain('Agua Costera');
    });
  });
});
