import { describe, it, expect } from 'vitest';
import { staleGateMinFor, freshnessMulFor } from './spotScoringEngine';

/**
 * The case these exist for: a flat 30-minute gate excluded every AEMET station
 * from every spot consensus, permanently, because an hourly network is never
 * that fresh. At Castrelo that was `aemet_1701X` — 1.7km from the water, listed
 * as preferred, and the station the thermal engine was validated on.
 */
describe('staleGateMinFor — the gate follows the network, not a stopwatch', () => {
  it('lets a punctual hourly AEMET reading through', () => {
    // Measured on production 20-Aug: AEMET readings arrive 64-89 min old, and
    // 100 min was seen at Castrelo. All of that is PUNCTUAL for an hourly
    // network that publishes up to 2h behind.
    for (const ageMin of [64, 89, 100, 120]) {
      expect(ageMin).toBeLessThanOrEqual(staleGateMinFor('aemet_1701X'));
    }
  });

  it('still drops an AEMET station that has actually stopped', () => {
    expect(staleGateMinFor('aemet_1701X')).toBeLessThan(6 * 60);
  });

  it('keeps the short networks short — a 40min Wunderground has missed 8 cycles', () => {
    expect(staleGateMinFor('wu_ISANAM1')).toBeLessThan(40);
    expect(staleGateMinFor('nt_28f26e')).toBeLessThan(60);
  });

  it('gives Meteoclimatic room for its own half-hour cadence', () => {
    // 22 and 28 min were both seen in production and are normal there.
    expect(staleGateMinFor('mc_ESGAL3200000032455A')).toBeGreaterThan(30);
  });

  it('accepts a bare source name as well as a station id', () => {
    expect(staleGateMinFor('aemet')).toBe(staleGateMinFor('aemet_1701X'));
  });

  it('falls back to a short gate for an unknown prefix', () => {
    // Unknown means unvetted. Being generous with a network we know nothing
    // about is how a dead sensor keeps voting.
    expect(staleGateMinFor('xx_whatever')).toBeLessThanOrEqual(staleGateMinFor('mg_19044'));
  });
});

describe('freshnessMulFor — being hourly is not itself a penalty', () => {
  it('does not punish an AEMET reading for arriving on its own schedule', () => {
    // The old ladder gave this 0.7, the floor, every single cycle: an hourly
    // network could never reach any other bucket.
    expect(freshnessMulFor('aemet_1701X', 55)).toBe(1.0);
  });

  it('still ranks a fresh reading above an old one at the same distance', () => {
    // An hour-old wind is an hour old whatever measured it. The gate lets it
    // in; the weight keeps it from outvoting something current.
    expect(freshnessMulFor('aemet_1701X', 150)).toBeLessThan(freshnessMulFor('wu_ISANAM1', 4));
  });

  it('decays by cycles missed, so each network is judged on its own clock', () => {
    // Both have missed roughly two cycles.
    expect(freshnessMulFor('aemet_1701X', 110)).toBe(freshnessMulFor('wu_ISANAM1', 9));
  });

  it('marks a Wunderground station late at an age that is punctual for AEMET', () => {
    expect(freshnessMulFor('wu_ISANAM1', 45)).toBeLessThan(freshnessMulFor('aemet_1701X', 45));
  });

  it('never returns zero — a demoted reading still carries information', () => {
    expect(freshnessMulFor('wu_ISANAM1', 600)).toBeGreaterThan(0);
  });

  it('is monotonic: older never weighs more', () => {
    const ages = [0, 5, 15, 30, 60, 120, 240];
    const w = ages.map((a) => freshnessMulFor('aemet_1701X', a));
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeLessThanOrEqual(w[i - 1]);
  });

  it('treats a negative age (clock skew) as fresh rather than ancient', () => {
    expect(freshnessMulFor('mg_19044', -5)).toBe(1.0);
  });
});
