/**
 * Tests for seaBreezeService — sector-wide thermal-gradient sea-breeze detector.
 *
 * Covers the pure core classifySeaBreeze (season/hour gates, ΔT levels,
 * phase progression, onshore confirmation) and the assessSeaBreezeRias
 * wrapper (coast/inland station classification by longitude, onshore wind
 * extraction). Clock is injected to keep tests timezone-stable.
 */
import { describe, it, expect } from 'vitest';
import { classifySeaBreeze, assessSeaBreezeRias, type SeaBreezeStation } from './seaBreezeService';
import type { NormalizedReading } from '../types/station';

// A July afternoon: in-season (month 6), in-window (hour 16)
const SUMMER_AFTERNOON = { hour: 16, month: 6 };

describe('classifySeaBreeze — gates', () => {
  it('inactive out of season (e.g. January)', () => {
    const r = classifySeaBreeze({ coastTemp: 18, inlandTemp: 28, hour: 16, month: 0, coastOnshore: true, coastWindKt: 12 });
    expect(r.active).toBe(false);
    expect(r.phase).toBe('none');
    expect(r.hypothesis).toMatch(/temporada/);
  });

  it('inactive outside the daytime window (e.g. 06h)', () => {
    const r = classifySeaBreeze({ coastTemp: 18, inlandTemp: 28, hour: 6, month: 6, coastOnshore: true, coastWindKt: 12 });
    expect(r.active).toBe(false);
    expect(r.hypothesis).toMatch(/franja/);
  });

  it('inactive when coast or inland temp missing', () => {
    const r = classifySeaBreeze({ coastTemp: null, inlandTemp: 28, ...SUMMER_AFTERNOON, coastOnshore: true, coastWindKt: 12 });
    expect(r.active).toBe(false);
    expect(r.hypothesis).toMatch(/temperatura/);
  });
});

describe('classifySeaBreeze — gradient levels', () => {
  it('inactive when gradient is below the weak threshold (<2°C)', () => {
    const r = classifySeaBreeze({ coastTemp: 20, inlandTemp: 21.5, ...SUMMER_AFTERNOON, coastOnshore: false, coastWindKt: null });
    expect(r.active).toBe(false);
    expect(r.deltaT).toBeCloseTo(1.5, 1);
    expect(r.hypothesis).toMatch(/motor térmico apagado/);
  });

  it('weak strength + building phase when gradient present but no onshore wind yet', () => {
    const r = classifySeaBreeze({ coastTemp: 20, inlandTemp: 23, ...SUMMER_AFTERNOON, coastOnshore: false, coastWindKt: null });
    expect(r.active).toBe(true);
    expect(r.strength).toBe('weak');
    expect(r.phase).toBe('building');
  });

  it('moderate + active when ΔT 4-7 and onshore wind filled in', () => {
    const r = classifySeaBreeze({ coastTemp: 19, inlandTemp: 24, ...SUMMER_AFTERNOON, coastOnshore: true, coastWindKt: 10 });
    expect(r.strength).toBe('moderate');
    expect(r.phase).toBe('active');
    expect(r.active).toBe(true);
  });

  it('strong + mature when ΔT ≥7 and onshore wind filled in', () => {
    const r = classifySeaBreeze({ coastTemp: 18, inlandTemp: 26, ...SUMMER_AFTERNOON, coastOnshore: true, coastWindKt: 14 });
    expect(r.strength).toBe('strong');
    expect(r.phase).toBe('mature');
    expect(r.confidence).toBeGreaterThanOrEqual(80);
  });

  it('strong gradient but no onshore wind yet → building (engine on, not filled in)', () => {
    const r = classifySeaBreeze({ coastTemp: 18, inlandTemp: 26, ...SUMMER_AFTERNOON, coastOnshore: false, coastWindKt: null });
    expect(r.strength).toBe('strong');
    expect(r.phase).toBe('building');
  });

  it('onshore but light (<5kt) does not count as filled in', () => {
    const r = classifySeaBreeze({ coastTemp: 19, inlandTemp: 24, ...SUMMER_AFTERNOON, coastOnshore: true, coastWindKt: 3 });
    expect(r.phase).toBe('building');
    expect(r.confidence).toBeLessThan(60);
  });

  it('confidence rises with strength + onshore confirmation', () => {
    const weak = classifySeaBreeze({ coastTemp: 20, inlandTemp: 23, ...SUMMER_AFTERNOON, coastOnshore: false, coastWindKt: null });
    const strong = classifySeaBreeze({ coastTemp: 18, inlandTemp: 26, ...SUMMER_AFTERNOON, coastOnshore: true, coastWindKt: 14 });
    expect(strong.confidence).toBeGreaterThan(weak.confidence);
  });
});

describe('assessSeaBreezeRias — station classification', () => {
  const coastA: SeaBreezeStation = { id: 'coastA', lat: 42.2, lon: -8.9 };  // west, coastal
  const coastB: SeaBreezeStation = { id: 'coastB', lat: 42.25, lon: -8.8 };
  const inlandA: SeaBreezeStation = { id: 'inlandA', lat: 42.3, lon: -8.3 }; // east, inland
  const inlandB: SeaBreezeStation = { id: 'inlandB', lat: 42.35, lon: -8.2 };
  const transition: SeaBreezeStation = { id: 'trans', lat: 42.3, lon: -8.55 }; // excluded gap

  const summerAfternoon = new Date('2026-07-15T16:00:00'); // local 16h July

  function reading(temp: number, windDir: number | null = null, windMs: number | null = null): NormalizedReading {
    return {
      stationId: 'x', timestamp: new Date(), windSpeed: windMs, windGust: null,
      windDirection: windDir, temperature: temp, humidity: null, precipitation: null,
      solarRadiation: null, pressure: null, dewPoint: null,
    };
  }

  it('computes ΔT from coast vs inland means, excludes transition zone', () => {
    const readings = new Map<string, NormalizedReading>([
      ['coastA', reading(19)],
      ['coastB', reading(19)],
      ['inlandA', reading(25)],
      ['inlandB', reading(25)],
      ['trans', reading(50)], // absurd temp in transition zone — must be EXCLUDED
    ]);
    const r = assessSeaBreezeRias(readings, [coastA, coastB, inlandA, inlandB, transition], summerAfternoon);
    expect(r.coastTemp).toBeCloseTo(19, 1);
    expect(r.inlandTemp).toBeCloseTo(25, 1);
    expect(r.deltaT).toBeCloseTo(6, 1);
    expect(r.active).toBe(true);
  });

  it('detects onshore SW wind at the coast → fills in', () => {
    const readings = new Map<string, NormalizedReading>([
      ['coastA', reading(19, 230, 6)], // SW onshore, ~11.7kt
      ['inlandA', reading(25)],
      ['inlandB', reading(25)],
    ]);
    const r = assessSeaBreezeRias(readings, [coastA, inlandA, inlandB], summerAfternoon);
    expect(r.onshoreAtCoast).toBe(true);
    expect(r.phase).toBe('active');
  });

  it('offshore (E) wind at coast does not count as onshore', () => {
    const readings = new Map<string, NormalizedReading>([
      ['coastA', reading(19, 90, 6)], // E = offshore for Rías
      ['inlandA', reading(24)],
      ['inlandB', reading(24)],
    ]);
    const r = assessSeaBreezeRias(readings, [coastA, inlandA, inlandB], summerAfternoon);
    expect(r.onshoreAtCoast).toBe(false);
    expect(r.phase).toBe('building');
  });

  it('returns inactive with no usable temps', () => {
    const readings = new Map<string, NormalizedReading>();
    const r = assessSeaBreezeRias(readings, [coastA, inlandA], summerAfternoon);
    expect(r.active).toBe(false);
  });
});
