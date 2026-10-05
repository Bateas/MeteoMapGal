import { describe, it, expect } from 'vitest';
import { updateArrivalChecks, CHECK_LATE_MIN, type ArrivalCheck } from './rainArrivalChecks';
import type { GaugeRain } from './rainNowService';

const T0 = Date.parse('2026-10-01T15:00:00+02:00');
const min = (n: number) => T0 + n * 60_000;
const SPOT = { id: 'cesantes', lon: -8.62, lat: 42.31 };
const SEA = { id: 'cies-ria', lon: -8.90, lat: 42.22 };
const spots = [SPOT, SEA];

function gauge(verdict: GaugeRain['verdict'], km = 3, name = 'Redondela'): GaugeRain {
  return { id: 'mg_x', name, lon: SPOT.lon + km / 82.4, lat: SPOT.lat, official: true, mm: verdict === 'rain' ? 0.8 : 0, verdict, radarDbz: null };
}
const say = (spotId: string, etaMin: number) => ({ spotId, spotName: spotId, etaMin });
function step(prev: ArrivalCheck[], at: number, arrivals: ReturnType<typeof say>[], gauges: GaugeRain[]) {
  return updateArrivalChecks(prev, { nowMs: at, arrivals, gauges, spots });
}

describe('updateArrivalChecks: the gauge confirms what the radar announced', () => {
  it('writes down the first announcement and marks it arrived when a gauge near the spot measures rain', () => {
    let c = step([], min(0), [say('cesantes', 30)], [gauge('dry')]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ status: 'pending', dueAt: min(30) });
    c = step(c, min(10), [say('cesantes', 15)], [gauge('dry')]);  // a later, different ETA does not replace it
    expect(c).toHaveLength(1);
    expect(c[0].dueAt).toBe(min(30));
    c = step(c, min(35), [], [gauge('rain')]);
    expect(c[0]).toMatchObject({ status: 'arrived', seenAt: min(35), gaugeName: 'Redondela', gaugeMm: 0.8 });
  });

  it('marks it missed when no gauge measured rain by half an hour after the time said', () => {
    let c = step([], min(0), [say('cesantes', 30)], [gauge('dry')]);
    c = step(c, min(30 + CHECK_LATE_MIN - 5), [], [gauge('dry')]);
    expect(c[0].status).toBe('pending');
    c = step(c, min(30 + CHECK_LATE_MIN + 5), [], [gauge('dry')]);
    expect(c[0].status).toBe('missed');
  });

  it('does not count radar echo over a spot that has a dry gauge near: it stays missed', () => {
    let c = step([], min(0), [say('cesantes', 20)], [gauge('dry')]);
    c = step(c, min(20), [say('cesantes', 0)], [gauge('dry')]);
    c = step(c, min(60), [], [gauge('dry')]);
    expect(c[0].status).toBe('missed');
    expect(c[0].radarSeenAt).toBe(min(20));
  });

  it('on open water with no gauge near, the radar is the only witness and is named as such', () => {
    let c = step([], min(0), [say('cies-ria', 20)], [gauge('dry')]);   // the gauge is 25 km away
    c = step(c, min(20), [say('cies-ria', 0)], [gauge('dry')]);
    c = step(c, min(60), [], [gauge('dry')]);
    expect(c[0]).toMatchObject({ status: 'arrived-radar', seenAt: min(20) });
  });

  it('opens no check where it is already raining, ignores a leaking gauge, and forgets old ones', () => {
    expect(step([], min(0), [say('cesantes', 30)], [gauge('rain')])).toEqual([]);
    let c = step([], min(0), [say('cesantes', 30)], [gauge('dry')]);
    c = step(c, min(35), [], [{ ...gauge('blacklist'), mm: 3 }]);
    expect(c[0].status).toBe('pending');
    c = step(c, min(35), [], [gauge('rain')]);
    c = step(c, min(35 + 181), [], [gauge('dry')]);
    expect(c).toEqual([]);
  });
});
