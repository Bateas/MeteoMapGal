import { describe, it, expect } from 'vitest';
import { welcomePanels, welcomePlan, toggleInterest, INTEREST_OPTIONS, type WelcomeAnswers } from './welcomeAssistant';

const answers = (over: Partial<WelcomeAnswers> = {}): WelcomeAnswers => ({ sector: 'rias', interests: [], spotId: null, ...over });

describe('the welcome assistant: three questions at most (18-nov)', () => {
  it('asks for a spot only of whoever looks at wind and waves', () => {
    expect(welcomePanels({ interests: [] })).toEqual(['zona', 'mira']);
    expect(welcomePanels({ interests: ['lluvia', 'campo'] })).toEqual(['zona', 'mira']);
    expect(welcomePanels({ interests: ['agua'] })).toEqual(['zona', 'mira', 'spot']);
  });

  it('several interests at once: whoever surfs also drives (May\'s profile asked for one)', () => {
    let list = toggleInterest([], 'agua');
    list = toggleInterest(list, 'lluvia');
    expect(list).toEqual(['agua', 'lluvia']);
    expect(toggleInterest(list, 'agua')).toEqual(['lluvia']);
  });

  it('nothing ticked leaves the app as it is: simple mode, no spot, nothing opened', () => {
    expect(welcomePlan(answers())).toEqual({
      sector: 'rias', simple: null, favoriteSpotId: null, openSpot: false, campoOpen: false, openConditions: false,
    });
  });

  it('a spot becomes the favourite and its card opens', () => {
    const plan = welcomePlan(answers({ interests: ['agua'], spotId: 'cesantes' }));
    expect(plan.favoriteSpotId).toBe('cesantes');
    expect(plan.openSpot).toBe(true);
  });

  it('a spot left over from unticking wind and waves is not kept', () => {
    expect(welcomePlan(answers({ interests: ['lluvia'], spotId: 'cesantes' })).favoriteSpotId).toBeNull();
  });

  it('«todo» is the advanced mode; nothing else changes the mode', () => {
    expect(welcomePlan(answers({ interests: ['todo'] })).simple).toBe(false);
    expect(welcomePlan(answers({ interests: ['agua', 'campo', 'lluvia', 'mar'] })).simple).toBeNull();
  });

  it('the field leaves «En el campo» open', () => {
    expect(welcomePlan(answers({ sector: 'embalse', interests: ['campo'] })).campoOpen).toBe(true);
  });

  it('sea and tides open Condiciones, where the tides are, only on the coast and only without a spot card', () => {
    expect(welcomePlan(answers({ interests: ['mar'] })).openConditions).toBe(true);
    expect(welcomePlan(answers({ sector: 'embalse', interests: ['mar'] })).openConditions).toBe(false);
    expect(welcomePlan(answers({ interests: ['mar', 'agua'], spotId: 'vao' })).openConditions).toBe(false);
  });

  it('the one answer that changes no setting says so, and no option promises what the app lacks', () => {
    const rain = INTEREST_OPTIONS.find((o) => o.id === 'lluvia')!;
    expect(rain.note).toMatch(/salen solos/);
    const all = JSON.stringify(INTEREST_OPTIONS).toLowerCase();
    expect(all).not.toContain('plaga');
    expect(all).not.toContain('perfil');
  });
});
