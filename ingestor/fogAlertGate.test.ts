import { describe, it, expect } from 'vitest';
import { fogCorroborated, type NearbyWeather } from './fogAlertGate';

const st = (o: Partial<NearbyWeather>): NearbyWeather => ({ distKm: 3, windKt: 6, spreadC: 0.8, rainMm60: 0, ...o });

describe('fogCorroborated — a camera alone never sends «niebla» (29-sep)', () => {
  it('real fog: saturated air, no rain, light wind → sent', () => {
    expect(fogCorroborated([st({}), st({ distKm: 6, windKt: 9, spreadC: 1.5 })]).ok).toBe(true);
  });

  it('the front of 29-sep at Cangas: rain nearby → not fog', () => {
    const r = fogCorroborated([st({ spreadC: 0.5, rainMm60: 1.2 }), st({ distKm: 7, windKt: 17 })]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/lluvia/);
  });

  it('strong wind at the most exposed station nearby → not fog, even with sheltered ones calm', () => {
    const r = fogCorroborated([st({ windKt: 2 }), st({ windKt: 4 }), st({ distKm: 7, windKt: 17 })]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/17 kt/);
  });

  it('dry air → not fog', () => {
    expect(fogCorroborated([st({ spreadC: 6 })]).ok).toBe(false);
  });

  it('nothing nearby to check it against → nothing is sent', () => {
    expect(fogCorroborated([]).ok).toBe(false);
    expect(fogCorroborated([st({ distKm: 25 })]).ok).toBe(false);
  });
});
