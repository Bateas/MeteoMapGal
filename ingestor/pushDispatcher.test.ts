/**
 * Pure-layer tests for the Web Push lightning-safety dispatcher.
 *
 * Covers payload building, the per endpoint|spot cooldown, the
 * aviso→peligro escalation bypass, and night silence. The IO layer
 * (web-push + push_subscriptions) is exercised in production via the
 * `[Push] ...` heartbeat logs, following the documented cycle-test pattern.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPushPayload,
  shouldSendPush,
  markPushSent,
  shouldNotifyRisk,
  PUSH_COOLDOWN_MS,
  type PushSendState,
} from './pushDispatcher.js';
import type { SpotLightningRisk } from '../src/services/lightningProximityService.js';

// Real interface from the shared brain — not an ad-hoc test shape.
function makeRisk(overrides: Partial<SpotLightningRisk> = {}): SpotLightningRisk {
  return {
    spotId: 'cesantes',
    spotName: 'Cesantes',
    sector: 'rias',
    level: 'aviso',
    nearestKm: 17.3,
    countNear: 0,
    count25: 5,
    approaching: true,
    etaMin: 25,
    freshestAgeMin: 3,
    ...overrides,
  };
}

// Local-time constructor keeps getHours() deterministic across CI timezones
// (documented gotcha: ISO-string + setSystemTime diverges between UTC and CEST).
const DAY = new Date(2026, 6, 21, 15, 0, 0);   // 15:00 local — outside 23-07
const NIGHT = new Date(2026, 6, 21, 2, 30, 0); // 02:30 local — inside 23-07

const KEY = 'https://push.example/sub-1|cesantes';

describe('buildPushPayload', () => {
  it('builds an aviso payload with distance and ETA', () => {
    const p = buildPushPayload('Cesantes', 'rias', 'cesantes', makeRisk({ nearestKm: 17.3, etaMin: 25 }));
    expect(p.title).toBe('Aviso de tormenta - Cesantes');
    expect(p.body).toBe('Tormenta a 17 km, acercandose. Llegada estimada ~25 min.');
    expect(p.url).toBe('/?sector=rias&spot=cesantes');
    expect(p.tag).toBe('lightning-cesantes');
  });

  it('builds an aviso payload without ETA when etaMin is null', () => {
    const p = buildPushPayload('Cesantes', 'rias', 'cesantes', makeRisk({ nearestKm: 21.6, etaMin: null }));
    expect(p.body).toBe('Tormenta a 22 km, acercandose.');
    expect(p.body).not.toContain('Llegada estimada');
  });

  it('builds a peligro payload with the get-out-of-the-water call', () => {
    const p = buildPushPayload('Patos', 'rias', 'patos', makeRisk({
      level: 'peligro', nearestKm: 4.2, countNear: 3, etaMin: null,
    }));
    expect(p.title).toBe('PELIGRO - Patos');
    expect(p.body).toBe('Rayos a menos de 10 km. Sal del agua.');
    expect(p.tag).toBe('lightning-patos');
  });

  it('tags per spot so a newer notification replaces, never stacks', () => {
    const a = buildPushPayload('Cesantes', 'rias', 'cesantes', makeRisk());
    const b = buildPushPayload('Patos', 'rias', 'patos', makeRisk({ spotId: 'patos' }));
    expect(a.tag).toBe('lightning-cesantes');
    expect(b.tag).toBe('lightning-patos');
    expect(a.tag).not.toBe(b.tag);
  });

  it('deep-links into the exact sector + spot', () => {
    const p = buildPushPayload('Castrelo', 'embalse', 'castrelo', makeRisk({
      spotId: 'castrelo', sector: 'embalse', level: 'peligro',
    }));
    expect(p.url).toBe('/?sector=embalse&spot=castrelo');
  });
});

describe('shouldSendPush — cooldown', () => {
  it('blocks a second send of the same level within the 45min cooldown', () => {
    const state: PushSendState = new Map();
    expect(shouldSendPush(state, KEY, 'aviso', DAY)).toBe(true);
    markPushSent(state, KEY, 'aviso', DAY);

    const tenMinLater = new Date(DAY.getTime() + 10 * 60_000);
    expect(shouldSendPush(state, KEY, 'aviso', tenMinLater)).toBe(false);

    const afterCooldown = new Date(DAY.getTime() + PUSH_COOLDOWN_MS + 60_000);
    expect(shouldSendPush(state, KEY, 'aviso', afterCooldown)).toBe(true);
  });

  it('lets the aviso→peligro escalation skip the cooldown', () => {
    const state: PushSendState = new Map();
    markPushSent(state, KEY, 'aviso', DAY);

    const fiveMinLater = new Date(DAY.getTime() + 5 * 60_000);
    expect(shouldSendPush(state, KEY, 'peligro', fiveMinLater)).toBe(true);
  });

  it('blocks a de-escalation peligro→aviso within the cooldown', () => {
    const state: PushSendState = new Map();
    markPushSent(state, KEY, 'peligro', DAY);

    const fiveMinLater = new Date(DAY.getTime() + 5 * 60_000);
    expect(shouldSendPush(state, KEY, 'aviso', fiveMinLater)).toBe(false);
  });

  it('scopes the cooldown to the endpoint|spot key', () => {
    const state: PushSendState = new Map();
    markPushSent(state, KEY, 'aviso', DAY);

    const otherSpot = 'https://push.example/sub-1|patos';
    const fiveMinLater = new Date(DAY.getTime() + 5 * 60_000);
    expect(shouldSendPush(state, otherSpot, 'aviso', fiveMinLater)).toBe(true);
  });
});

describe('shouldSendPush — night silence 23-07', () => {
  it('silences aviso at night', () => {
    expect(shouldSendPush(new Map(), KEY, 'aviso', NIGHT)).toBe(false);
    const elevenPm = new Date(2026, 6, 21, 23, 5, 0);
    expect(shouldSendPush(new Map(), KEY, 'aviso', elevenPm)).toBe(false);
  });

  it('does NOT silence peligro at night — safety beats sleep', () => {
    expect(shouldSendPush(new Map(), KEY, 'peligro', NIGHT)).toBe(true);
  });

  it('allows aviso again from 07:00', () => {
    const sevenAm = new Date(2026, 6, 21, 7, 0, 0);
    expect(shouldSendPush(new Map(), KEY, 'aviso', sevenAm)).toBe(true);
  });
});

describe('shouldNotifyRisk — aviso requires an approaching storm', () => {
  it('drops an aviso for a static storm (map info, not pocket info)', () => {
    expect(shouldNotifyRisk(makeRisk({ approaching: false }))).toBe(false);
  });

  it('passes an approaching aviso', () => {
    expect(shouldNotifyRisk(makeRisk({ approaching: true }))).toBe(true);
  });

  it('always passes peligro, approaching or not', () => {
    expect(shouldNotifyRisk(makeRisk({ level: 'peligro', approaching: false }))).toBe(true);
  });
});
