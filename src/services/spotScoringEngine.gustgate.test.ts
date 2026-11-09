/**
 * The verdict cannot ignore the gust. 9-nov: Centro Ria BUENO with 14 kt and gusts of 30.
 */
import { describe, it, expect } from 'vitest';
import {
  gustGateReading, isGustGate, scoreAllSpots, GUST_GATE_HOLD_MS, type GustSource,
} from './spotScoringEngine';
import { RIAS_SPOTS } from '../config/spots';
import type { VerdictHoldState } from './verdictHold';
import type { NormalizedReading, NormalizedStation } from '../types/station';

const NOW = Date.UTC(2026, 10, 9, 13, 0);
const MIN = 60_000;
const kt = (v: number) => v / 1.94384;

const src = (sensorId: string, gustKt: number, extra: Partial<GustSource> = {}): GustSource =>
  ({ sensorId, gustKt, meanKt: 16, distKm: 3, time: new Date(NOW - 5 * MIN), altitudeM: 10, ...extra });

describe('gustGateReading — two instruments, under the rules of the gust shown', () => {
  it('one at 30 kt or more and another at 25 or more close it (9-nov: Cangas 34, Porto de Vigo 29)', () => {
    expect(gustGateReading([src('a', 29), src('b', 34), src('c', 20)], NOW)).toEqual({ peakKt: 34, secondKt: 29 });
  });

  it('one is never enough, however strong, and neither are two under 30', () => {
    expect(gustGateReading([src('a', 45), src('b', 24)], NOW)).toBeNull();
    expect(gustGateReading([src('a', 45)], NOW)).toBeNull();
    expect(gustGateReading([src('a', 29), src('b', 28)], NOW)).toBeNull();
  });

  it('a station and its copy in the buoy feed are one instrument', () => {
    expect(gustGateReading([src('mg_10126', 39), src('mg_10126', 39, { altitudeM: 0 })], NOW)).toBeNull();
  });

  it('the limit is the figure shown, in whole knots', () => {
    expect(gustGateReading([src('a', 29.4), src('b', 28)], NOW)).toBeNull();
    expect(gustGateReading([src('a', 29.6), src('b', 28)], NOW)).not.toBeNull();
    expect(gustGateReading([src('a', 40), src('b', 24.4)], NOW)).toBeNull();
    expect(gustGateReading([src('a', 40), src('b', 24.6)], NOW)).not.toBeNull();
  });

  it('a gust far away, on a hill, old, blacklisted or impossible for its own mean does not count', () => {
    const other = src('ok', 35);
    for (const bad of [
      src('x', 40, { distKm: 9 }),
      src('x', 40, { altitudeM: 400 }),
      src('x', 40, { time: new Date(NOW - 61 * MIN) }),
      src('x', 40, { blacklisted: true }),
      src('x', 40, { meanKt: 4 }),
    ]) expect(gustGateReading([other, bad], NOW)).toBeNull();
  });
});

describe('scoreAllSpots with the gust gate', () => {
  const spot = RIAS_SPOTS.find((s) => s.id === 'centro-ria')!;
  const stationAt = (id: string): NormalizedStation =>
    ({ id, name: id, lat: spot.center[1] + 0.01, lon: spot.center[0], altitude: 10, source: 'meteogalicia', tempOnly: false });
  const reading = (id: string, meanKt: number, gustKt: number): NormalizedReading => ({
    stationId: id, timestamp: new Date(), windSpeed: kt(meanKt), windGust: kt(gustKt), windDirection: 190,
    temperature: 16, humidity: 90, precipitation: null, solarRadiation: null, pressure: 1005, dewPoint: 14,
  });
  const score = (gusts: [number, number], meanKt = 14, hold?: { states: Map<string, VerdictHoldState>; nowMs: number }) =>
    scoreAllSpots([spot], [stationAt('g1'), stationAt('g2')], new Map([
      ['g1', reading('g1', meanKt, gusts[0])],
      ['g2', reading('g2', meanKt, gusts[1])],
    ]), [], undefined, undefined, undefined, undefined, undefined, hold).get(spot.id)!;

  it('14 kt of mean with gusts of 33 and 27 at two stations is FUERTE, and says why', () => {
    const s = score([33, 27]);
    expect(s.verdict).toBe('strong');
    expect(isGustGate(s.hardGateTriggered)).toBe(true);
    expect(s.hardGateKind).toBe('wind');
    expect(s.hardGateTriggered).toBe('Rachas de 33 kt, y 27 kt en otra estación');
    expect(s.summary).toMatch(/rachas de 33 kt, y 27 kt/);
    expect(s.score).toBe(0);
  });

  it('one station gusting does not close it', () => {
    const s = score([33, 20]);
    expect(s.verdict).not.toBe('strong');
    expect(s.hardGateTriggered).toBeNull();
  });

  it('a spot already FUERTE by its mean keeps its normal reading', () => {
    const s = score([33, 31], 20);
    expect(s.verdict).toBe('strong');
    expect(s.hardGateTriggered).toBeNull();
  });

  it('a surf spot is judged by the sea, not by this', () => {
    const surf = RIAS_SPOTS.find((s) => s.category === 'surf')!;
    const near = (id: string): NormalizedStation => ({ ...stationAt(id), lat: surf.center[1] + 0.01, lon: surf.center[0] });
    const s = scoreAllSpots([surf], [near('g1'), near('g2')], new Map([
      ['g1', reading('g1', 14, 33)], ['g2', reading('g2', 14, 31)],
    ]), []).get(surf.id)!;
    expect(isGustGate(s.hardGateTriggered)).toBe(false);
  });

  it('on the map it stays closed a while after the last gust, with the text of that gust', () => {
    const states = new Map<string, VerdictHoldState>();
    expect(score([33, 31], 14, { states, nowMs: NOW }).verdict).toBe('strong');
    const later = score([20, 19], 14, { states, nowMs: NOW + 10 * MIN });
    expect(later.verdict).toBe('strong');
    expect(later.hardGateTriggered).toBe('Rachas de 33 kt, y 31 kt en otra estación');
    const after = score([20, 19], 14, { states, nowMs: NOW + GUST_GATE_HOLD_MS + MIN });
    expect(after.verdict).not.toBe('strong');
    expect(after.hardGateTriggered).toBeNull();
  });

  it('a new gust renews the time', () => {
    const states = new Map<string, VerdictHoldState>();
    score([33, 31], 14, { states, nowMs: NOW });
    score([35, 30], 14, { states, nowMs: NOW + 12 * MIN });
    const s = score([20, 19], 14, { states, nowMs: NOW + 12 * MIN + GUST_GATE_HOLD_MS - MIN });
    expect(s.hardGateTriggered).toBe('Rachas de 35 kt, y 30 kt en otra estación');
  });

  it('without the hold state (server) it follows each reading', () => {
    expect(score([33, 31]).verdict).toBe('strong');
    expect(score([20, 19]).hardGateTriggered).toBeNull();
  });
});

describe('isGustGate', () => {
  it('knows the gust gate from the others', () => {
    expect(isGustGate('Rachas de 33 kt, y 27 kt en otra estación')).toBe(true);
    expect(isGustGate('Viento 31kt > 30kt')).toBe(false);
    expect(isGustGate('Oleaje 3,2 m > 3 m')).toBe(false);
    expect(isGustGate(null)).toBe(false);
  });
});
