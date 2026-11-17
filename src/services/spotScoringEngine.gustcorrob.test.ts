/**
 * A gust above its own station's ratio counts when another instrument around the spot backs it
 * (17-nov 11:48, Castrelo: the card read «racha 15» with SkyX at 32 and Prado at 21).
 */
import { describe, it, expect } from 'vitest';
import {
  spotGustKt, gustGateReading, GUST_CORROBORATION_RATIO, GUST_CORROBORATION_MIN_MEAN_KT, type GustSource,
} from './spotScoringEngine';

const NOW = Date.UTC(2026, 10, 17, 10, 48);
const src = (sensorId: string, meanKt: number, gustKt: number, extra: Partial<GustSource> = {}): GustSource =>
  ({ sensorId, meanKt, gustKt, distKm: 3, time: new Date(NOW - 5 * 60_000), altitudeM: 100, ...extra });

describe('spotGustKt — gusts backed by a second instrument', () => {
  it('Castrelo 17-nov: SkyX 32/10.5 and Prado 21/5.3 back each other; Remuíño 15 is no longer the gust', () => {
    const s = [src('skyx_SKY100', 10.5, 31.9), src('mg_19032', 5.3, 21.4), src('mg_19044', 5.8, 14.8), src('mg_19026', 1.1, 4.9)];
    expect(spotGustKt(s, NOW, 250)).toBeCloseTo(31.9, 1);
  });

  it('a lone spike over a weak neighbour still does not count', () => {
    // 39 over 3.9 (wu_IMARN3) with the next gust at 14: 14 < 0.6 x 39
    expect(spotGustKt([src('wu_A', 3.9, 39), src('mg_B', 6, 14)], NOW)).toBeCloseTo(14, 1);
  });

  it('a dead mean never counts, backed or not', () => {
    expect(GUST_CORROBORATION_MIN_MEAN_KT).toBe(2);
    expect(spotGustKt([src('wu_A', 0.5, 25), src('mg_B', 8, 24)], NOW)).toBeCloseTo(24, 1);
  });

  it('two rows of the same anemometer do not back each other', () => {
    const s = [src('mg_10126', 6, 25), src('mg_10126', 6, 25, { altitudeM: 0 })];
    expect(spotGustKt(s, NOW)).toBeNull();
  });

  it('the backer must be in range: a hill station or an old reading does not back', () => {
    expect(spotGustKt([src('a', 6, 25), src('b', 6, 24, { altitudeM: 400 })], NOW, 250)).toBeNull();
    expect(spotGustKt([src('a', 6, 25), src('b', 6, 24, { time: new Date(NOW - 90 * 60_000) })], NOW)).toBeNull();
  });

  it('the share is 0.6 of the gust being backed', () => {
    expect(GUST_CORROBORATION_RATIO).toBe(0.6);
    expect(spotGustKt([src('a', 6, 30), src('b', 8, 18)], NOW)).toBeCloseTo(30, 1);
    expect(spotGustKt([src('a', 6, 30), src('b', 8, 17.9)], NOW)).toBeCloseTo(17.9, 1);
  });

  it('even backed, a gust stays within max(5x its mean, mean + 20)', () => {
    expect(spotGustKt([src('x', 4, 40), src('ok', 16, 35)], NOW)).toBeCloseTo(35, 1);
    expect(spotGustKt([src('x', 3.3, 23), src('ok', 8, 19)], NOW)).toBeCloseTo(23, 1); // AEMET hourly max, light wind
  });

  it('the FUERTE gate reads the same gusts', () => {
    expect(gustGateReading([src('a', 9, 31), src('b', 8, 26)], NOW)).toEqual({ peakKt: 31, secondKt: 26 });
    expect(gustGateReading([src('a', 3.9, 39), src('b', 6, 14)], NOW)).toBeNull();
  });
});
