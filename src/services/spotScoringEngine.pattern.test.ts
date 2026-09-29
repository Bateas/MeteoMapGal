/**
 * A breeze pattern is not named while a front aloft vetoes the breeze. On 29-sep the card of
 * «Ría de Vigo (centro)» said «Entra viento de frente (42 kt SSW a 1.500 m): … sin refuerzo de
 * brisa» and, a few lines below, «Brisa SW (tardes) activa»: the pattern matched only because
 * the front's SSW sits within 45° of the breeze direction.
 */
import { describe, it, expect } from 'vitest';
import { scoreAllSpots } from './spotScoringEngine';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import { RIAS_SPOTS } from '../config/spots';

const kt = (v: number) => v / 1.94384;
const FRONT = { speedKt: 42, dirDeg: 212 };

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
