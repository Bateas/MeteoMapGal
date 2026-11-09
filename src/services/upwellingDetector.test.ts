import { describe, it, expect } from 'vitest';
import { classifyWaterMass, detectUpwellingSummary } from './upwellingDetector';
import type { BuoyReading } from '../api/buoyClient';

const JUL = Date.parse('2026-07-15T12:00:00Z');
const NOV = Date.parse('2026-11-09T12:00:00Z');
const KT = 1 / 1.94384;

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

  describe('detectUpwellingSummary', () => {
    const mockBuoy = (
      id: number,
      name: string,
      waterTemp: number | null,
      salinity: number | null = null,
      wind: { kt: number; dir: number } | null = null,
    ): BuoyReading => ({
      stationId: id,
      stationName: name,
      timestamp: new Date(JUL).toISOString(),
      waveHeight: null,
      waveHeightMax: null,
      wavePeriod: null,
      wavePeriodMean: null,
      waveDir: null,
      windSpeed: wind ? wind.kt * KT : null,
      windDir: wind ? wind.dir : null,
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
        mockBuoy(2248, 'Cabo Silleiro', 17.6, 35.6, { kt: 14, dir: 350 }),
      ];

      const res = detectUpwellingSummary(buoys, JUL);
      expect(res.hasUpwelling).toBe(true);
      expect(res.coldestBuoy?.name).toBe('Rande (Ría Vigo)');
      expect(res.coldestBuoy?.temp).toBe(14.0);
      expect(res.thermalFront).not.toBeNull();
      expect(res.thermalFront?.deltaT).toBeCloseTo(3.6, 1);
      expect(res.tickerMessage).toContain('Afloramiento: agua a');
      expect(res.tickerMessage).toContain('Frente térmico');
      expect(res.fishingAdvice?.toLowerCase()).toContain('calamar');
    });

    describe('cold water is not enough', () => {
      const cold = mockBuoy(1251, 'Rande (Ría Vigo)', 14.0, 35.2);
      const silleiro = (wind: { kt: number; dir: number } | null, atMs = JUL) => ({
        ...mockBuoy(2248, 'Cabo Silleiro', 17.6, 35.6, wind),
        timestamp: new Date(atMs).toISOString(),
      });

      it('a southerly offshore is the opposite of upwelling (9-nov, with a gale from the south)', () => {
        const res = detectUpwellingSummary([cold, silleiro({ kt: 22, dir: 190 })], JUL);
        expect(res.hasUpwelling).toBe(false);
        expect(res.tickerMessage).toBeNull();
        expect(res.fishingAdvice).toBeNull();
      });

      it('a westerly has no southerly component and does not rule it out', () => {
        expect(detectUpwellingSummary([cold, silleiro({ kt: 15, dir: 270 })], JUL).hasUpwelling).toBe(true);
      });

      it('a light southerly under the limit does not rule it out either', () => {
        expect(detectUpwellingSummary([cold, silleiro({ kt: 6, dir: 180 })], JUL).hasUpwelling).toBe(true);
      });

      it('without wind at the outer buoys it says nothing', () => {
        expect(detectUpwellingSummary([cold, silleiro(null)], JUL).hasUpwelling).toBe(false);
      });

      it('a wind reading that stopped publishing counts as no wind', () => {
        const old = silleiro({ kt: 14, dir: 350 }, JUL - 4 * 60 * 60_000);
        expect(detectUpwellingSummary([cold, old], JUL).hasUpwelling).toBe(false);
      });

      it('outside the season it says nothing, even with north wind', () => {
        const res = detectUpwellingSummary([{ ...cold, timestamp: new Date(NOV).toISOString() }, silleiro({ kt: 14, dir: 350 }, NOV)], NOV);
        expect(res.hasUpwelling).toBe(false);
        expect(res.coldestBuoy?.name).toBe('Rande (Ría Vigo)');
      });
    });

    it('discards sensor glitches (< 10.5°C) from triggering fake upwelling', () => {
      const buoys: BuoyReading[] = [
        mockBuoy(1250, 'Cortegada (Arousa)', 8.4, 25.3),
        mockBuoy(2248, 'Cabo Silleiro', 17.6, 35.6),
      ];

      const res = detectUpwellingSummary(buoys, JUL);
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

      const res = detectUpwellingSummary(buoys, JUL);
      expect(res.hasUpwelling).toBe(false);
      expect(res.coldestBuoy?.name).toBe('Cabo Silleiro');
    });

    it('ignores a buoy that stopped publishing, however cold its last reading', () => {
      const now = Date.parse('2026-09-22T01:00:00Z');
      const dayOld = { ...mockBuoy(1251, 'Rande (Ría Vigo)', 14.0, 35.2), timestamp: '2026-09-20T19:40:00Z' };
      const fresh = { ...mockBuoy(2248, 'Cabo Silleiro', 17.6, 35.6), timestamp: '2026-09-22T00:30:00Z' };

      const res = detectUpwellingSummary([dayOld, fresh], now);
      expect(res.hasUpwelling).toBe(false);
      expect(res.tickerMessage).toBeNull();
      expect(res.coldestBuoy?.name).toBe('Cabo Silleiro');
      expect(res.thermalFront).toBeNull();
    });

    it('still uses a reading a few hours old: the water mass changes slowly', () => {
      const now = Date.parse('2026-09-22T01:00:00Z');
      const threeHours = { ...mockBuoy(1251, 'Rande (Ría Vigo)', 14.0, 35.2), timestamp: '2026-09-21T22:00:00Z' };
      const windNow = { ...mockBuoy(2248, 'Cabo Silleiro', 17.6, 35.6, { kt: 12, dir: 0 }), timestamp: '2026-09-22T00:30:00Z' };

      const res = detectUpwellingSummary([threeHours, windNow], now);
      expect(res.hasUpwelling).toBe(true);
    });

    it('does not trigger upwelling when water is universally warm', () => {
      const buoys: BuoyReading[] = [
        mockBuoy(1251, 'Rande (Ría Vigo)', 18.5, 35.4),
        mockBuoy(2248, 'Cabo Silleiro', 19.0, 35.6),
      ];

      const res = detectUpwellingSummary(buoys, JUL);
      expect(res.hasUpwelling).toBe(false);
      expect(res.tickerMessage).toBeNull();
    });
  });
});
