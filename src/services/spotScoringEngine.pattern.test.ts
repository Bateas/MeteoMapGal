/**
 * A breeze pattern is not named while a front aloft vetoes the breeze. On 29-sep the card of
 * «Ría de Vigo (centro)» said «Entra viento de frente (42 kt SSW a 1.500 m): … sin refuerzo de
 * brisa» and, a few lines below, «Brisa SW (tardes) activa»: the pattern matched only because
 * the front's SSW sits within 45° of the breeze direction.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { scoreAllSpots } from './spotScoringEngine';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import { RIAS_SPOTS, ALL_SPOTS, patternHours } from '../config/spots';

const kt = (v: number) => v / 1.94384;
const FRONT = { speedKt: 42, dirDeg: 212 };
/** Local time in Galicia on 29-sep (CEST, UTC+2). */
const at = (hhmm: string) => new Date(`2026-09-29T${hhmm}:00+02:00`);

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(at('16:00')); });
afterEach(() => { vi.useRealTimers(); });

function around(spotId: string, meanKt: number, dir: number) {
  const spot = RIAS_SPOTS.find((s) => s.id === spotId)!;
  const [lon, lat] = spot.center;
  const stations: NormalizedStation[] = [0, 1, 2].map((i) => ({
    id: `mg_t${i}`, name: `t${i}`, lat: lat + 0.01 * (i - 1), lon: lon + 0.005, altitude: 10, source: 'meteogalicia', tempOnly: false,
  }));
  const readings = new Map<string, NormalizedReading>(stations.map((s) => [s.id, {
    stationId: s.id, timestamp: new Date(), windSpeed: kt(meanKt), windGust: kt(meanKt * 1.6), windDirection: dir,
    temperature: 20, humidity: 85, precipitation: null, solarRadiation: null, pressure: 1008, dewPoint: 17,
  }]));
  return { spot, stations, readings };
}

describe('wind patterns under the front veto (29-sep)', () => {
  it('centro-ria with SSW and a front aloft: no «Brisa SW (tardes)», in the pattern or in the summary', () => {
    const { spot, stations, readings } = around('centro-ria', 13, 188);
    const score = scoreAllSpots([spot], stations, readings, [], undefined, undefined, undefined, undefined, FRONT).get('centro-ria')!;
    expect(score.wind?.matchedPattern ?? null).toBeNull();
    expect(score.summary).not.toMatch(/Brisa/);
  });

  it('the same wind without a front still names the breeze', () => {
    const { spot, stations, readings } = around('centro-ria', 13, 188);
    const score = scoreAllSpots([spot], stations, readings, []).get('centro-ria')!;
    expect(score.wind?.matchedPattern).toBe('Brisa SW (tardes)');
  });

  it('a pattern that IS the front (Liméns «Sur (fuerte)») is still named with the veto on', () => {
    const { spot, stations, readings } = around('limens', 16, 180);
    const score = scoreAllSpots([spot], stations, readings, [], undefined, undefined, undefined, undefined, FRONT).get('limens')!;
    expect(score.wind?.matchedPattern).toBe('Sur (fuerte)');
  });
});

describe('wind patterns named for a time of day (29-sep: «Offshore S/SSW (mañanas)» at 16:00)', () => {
  it('a SW wind at 09:00 is not «Brisa SW (tardes)»; the same wind at 15:00 is', () => {
    vi.setSystemTime(at('09:00'));
    let { spot, stations, readings } = around('centro-ria', 13, 225);
    expect(scoreAllSpots([spot], stations, readings, []).get('centro-ria')!.wind?.matchedPattern ?? null).toBeNull();
    vi.setSystemTime(at('15:00'));
    ({ spot, stations, readings } = around('centro-ria', 13, 225));
    expect(scoreAllSpots([spot], stations, readings, []).get('centro-ria')!.wind?.matchedPattern).toBe('Brisa SW (tardes)');
  });

  it('an easterly at 09:00 is «Viento de tierra (mañanas)»; at 16:00 it is not named', () => {
    vi.setSystemTime(at('09:00'));
    let { spot, stations, readings } = around('centro-ria', 12, 75);
    expect(scoreAllSpots([spot], stations, readings, []).get('centro-ria')!.wind?.matchedPattern).toBe('Viento de tierra (mañanas)');
    vi.setSystemTime(at('16:00'));
    ({ spot, stations, readings } = around('centro-ria', 12, 75));
    expect(scoreAllSpots([spot], stations, readings, []).get('centro-ria')!.wind?.matchedPattern ?? null).toBeNull();
  });

  it('Patos, S gale at 16:00: no «Offshore S/SSW (mañanas)»', () => {
    const { spot, stations, readings } = around('surf-patos', 25, 190);
    expect(scoreAllSpots([spot], stations, readings, []).get('surf-patos')!.wind?.matchedPattern ?? null).toBeNull();
  });

  it('every pattern whose name says a time of day has its hours', () => {
    const named = ALL_SPOTS.flatMap((s) => s.windPatterns.map((p) => p.name)).filter((n) => /mañana|tarde|noche|mediod/i.test(n));
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((n) => patternHours(n) == null)).toEqual([]);
  });
});
