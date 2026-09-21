import { describe, it, expect } from 'vitest';
import { classifyWaterMass, detectUpwellingSummary } from './upwellingDetector';
import type { BuoyReading } from '../api/buoyClient';

describe('upwellingDetector', () => {
  describe('classifyWaterMass', () => {
    it('returns unknown when both temp and salinity are null', () => {
      const res = classifyWaterMass(null, null);
      expect(res.type).toBe('unknown');
    });

    it('classifies cold water (<= 14.5°C) with oceanic salinity as ACNA upwelling', () => {
      const res = classifyWaterMass(14.0, null);
      expect(res.type).toBe('acna');
      expect(res.badgeText).toContain('Afloramiento ACNA');
    });

    it('classifies water <= 14.8°C with high oceanic salinity (>= 34.5 PSU) as ACNA', () => {
      const res = classifyWaterMass(14.8, 35.6);
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

  describe('detectUpwellingSummary', () => {
    const mockBuoy = (
      id: number,
      name: string,
      waterTemp: number | null,
      salinity: number | null = null,
    ): BuoyReading => ({
      stationId: id,
      stationName: name,
      timestamp: new Date().toISOString(),
      waveHeight: null,
      waveHeightMax: null,
      wavePeriod: null,
      wavePeriodMean: null,
      waveDir: null,
      windSpeed: null,
      windDir: null,
      windGust: null,
      waterTemp,
      airTemp: null,
      airPressure: null,
      currentSpeed: null,
      currentDir: null,
      salinity,
      seaLevel: null,
      humidity: null,
      dewPoint: null,
    });

    it('returns false when no buoys are available', () => {
      const res = detectUpwellingSummary([]);
      expect(res.hasUpwelling).toBe(false);
      expect(res.coldestBuoy).toBeNull();
    });

    it('detects upwelling when cold water is reported in the rías', () => {
      const buoys: BuoyReading[] = [
        mockBuoy(1251, 'Rande (Ría Vigo)', 14.0, 35.2),
        mockBuoy(2248, 'Cabo Silleiro', 17.6, 35.6),
      ];

      const res = detectUpwellingSummary(buoys);
      expect(res.hasUpwelling).toBe(true);
      expect(res.coldestBuoy?.name).toBe('Rande (Ría Vigo)');
      expect(res.coldestBuoy?.temp).toBe(14.0);
      expect(res.thermalFront).not.toBeNull();
      expect(res.thermalFront?.deltaT).toBeCloseTo(3.6, 1);
      expect(res.tickerMessage).toContain('Afloramiento: agua a');
      expect(res.tickerMessage).toContain('Frente térmico');
      expect(res.fishingAdvice?.toLowerCase()).toContain('calamar');
    });

    it('discards sensor glitches (< 10.5°C) from triggering fake upwelling', () => {
      const buoys: BuoyReading[] = [
        mockBuoy(1250, 'Cortegada (Arousa)', 8.4, 25.3),
        mockBuoy(2248, 'Cabo Silleiro', 17.6, 35.6),
      ];

      const res = detectUpwellingSummary(buoys);
      expect(res.hasUpwelling).toBe(false);
      expect(res.coldestBuoy?.name).toBe('Cabo Silleiro');
      expect(res.thermalFront).toBeNull();
      expect(res.tickerMessage).toBeNull();
    });

    it('discards estuarine river plumes (< 33 PSU) from triggering fake upwelling', () => {
      const buoys: BuoyReading[] = [
        mockBuoy(1250, 'Cortegada (Arousa)', 13.5, 25.3),
        mockBuoy(2248, 'Cabo Silleiro', 17.6, 35.6),
      ];

      const res = detectUpwellingSummary(buoys);
      expect(res.hasUpwelling).toBe(false);
      expect(res.coldestBuoy?.name).toBe('Cabo Silleiro');
    });

    it('does not trigger upwelling when water is universally warm', () => {
      const buoys: BuoyReading[] = [
        mockBuoy(1251, 'Rande (Ría Vigo)', 18.5, 35.4),
        mockBuoy(2248, 'Cabo Silleiro', 19.0, 35.6),
      ];

      const res = detectUpwellingSummary(buoys);
      expect(res.hasUpwelling).toBe(false);
      expect(res.tickerMessage).toBeNull();
    });
  });
});
