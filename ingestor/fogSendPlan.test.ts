import { describe, it, expect } from 'vitest';
import { planFogMessages, type CameraVerdict } from './fogSendPlan';

// 11-oct 12:44 in Madrid: the sun is high (~40 degrees), no camera is blinded.
const NOW = new Date('2026-10-11T10:44:00Z').getTime();
const v = (webcamId: string, fog: boolean, over: Partial<CameraVerdict> = {}): CameraVerdict => ({
  webcamId, spotId: 'cies-ria', fog, visibility: fog ? 'poor' : 'good', analyzedAt: new Date(NOW - 60_000), ...over,
});
const ok = { ok: true, reason: '' };
const plan = (results: CameraVerdict[], latest: CameraVerdict[], gates: Record<string, { ok: boolean; reason: string }> = {}) =>
  planFogMessages(results, new Map(latest.map((x) => [x.webcamId, x])), new Map(Object.entries(gates)), NOW);

describe('planFogMessages — one place, one message, and only fog that can be trusted', () => {
  it('both Cies lighthouse cameras see fog: one message for the site (10 and 11-oct went out twice)', () => {
    const r = [v('mg-ciesfaro-sur', true), v('mg-ciesfaro-norte', true)];
    const p = plan(r, r, { 'mg-ciesfaro-sur': ok, 'mg-ciesfaro-norte': ok });
    expect(p.filter((x) => x.send).map((x) => x.site)).toEqual(['cies-faro']);
  });

  it('a mountain camera (Castrove) and the misted Ons Praia glass do not send', () => {
    const r = [v('mg-castrove', true), v('mg-ons-praia', true)];
    const p = plan(r, r, { 'mg-castrove': ok, 'mg-ons-praia': ok });
    expect(p.every((x) => !x.send)).toBe(true);
    expect(p.map((x) => x.reason).join(' | ')).toMatch(/monte.*cristal/);
  });

  it('Ons Porto fog with Ons Praia seeing clear: the site disagrees, nothing goes out (its clear still counts)', () => {
    const r = [v('mg-ons-porto', true)];
    const p = plan(r, [v('mg-ons-porto', true), v('mg-ons-praia', false)], { 'mg-ons-porto': ok });
    expect(p[0].send).toBe(false);
    expect(p[0].reason).toMatch(/mismo sitio/);
  });

  it('the stations around it must corroborate it', () => {
    const r = [v('mg-cangas', true, { spotId: 'centro-ria' })];
    const p = plan(r, r, { 'mg-cangas': { ok: false, reason: 'llueve cerca: es lluvia, no niebla' } });
    expect(p[0].send).toBe(false);
    expect(p[0].reason).toMatch(/llueve/);
  });

  it('a camera looking into the low sun does not send (Ons Porto, 27-sep 18:50)', () => {
    const t = new Date('2026-09-27T16:50:00Z');
    const r = [v('mg-ons-porto', true, { analyzedAt: t })];
    const p = planFogMessages(r, new Map([['mg-ons-porto', r[0]]]), new Map([['mg-ons-porto', ok]]), t.getTime() + 60_000);
    expect(p[0].send).toBe(false);
    expect(p[0].reason).toMatch(/sol/);
  });

  it('haze, or fog without poor visibility, is not a message', () => {
    expect(plan([v('mg-cangas', true, { visibility: 'moderate' })], [], { 'mg-cangas': ok })).toEqual([]);
  });
});
