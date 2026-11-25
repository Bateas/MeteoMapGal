/**
 * «Racheado»: a spot shown Calma or Flojo with gusts worth a word (24-nov: Liméns read «Calma, 5 kt»
 * beside «racha 21» through a front).
 */
import { describe, it, expect } from 'vitest';
import { isGusty, GUSTY_MIN_KT, GUSTY_RATIO, GUSTY_LABEL, type VerdictSource } from './verdictStyles';

const score = (verdict: VerdictSource['verdict'], kt: number, gustKt: number | null, extra: Partial<VerdictSource> = {}): VerdictSource =>
  ({ verdict, effectiveWindKt: kt, gustKt, ...extra });

describe('isGusty', () => {
  it('the thresholds and the word', () => {
    expect(GUSTY_MIN_KT).toBe(18);
    expect(GUSTY_RATIO).toBe(2);
    expect(GUSTY_LABEL).toBe('racheado');
  });

  it('Liméns 24-nov: calm at 5 kt with a gust of 21', () => {
    expect(isGusty(score('calm', 5, 21))).toBe(true);
    expect(isGusty(score('light', 7, 18))).toBe(true);
  });

  it('a gust under 18 kt, as shown in whole knots, says nothing', () => {
    expect(isGusty(score('calm', 5, 17.4))).toBe(false);
    expect(isGusty(score('calm', 5, 17.6))).toBe(true);
  });

  it('the gust has to be twice the mean', () => {
    expect(isGusty(score('light', 9.5, 18.9))).toBe(false);
    expect(isGusty(score('light', 9.4, 18.9))).toBe(true);
  });

  it('only under Calma or Flojo: from Navegable up the verdict already speaks of wind', () => {
    expect(isGusty(score('sailing', 8, 25))).toBe(false);
    expect(isGusty(score('good', 12, 28))).toBe(false);
    expect(isGusty(score('strong', 20, 45))).toBe(false);
  });

  it('never while loading, closed by a gate or without a figure', () => {
    expect(isGusty(score('calm', 5, 21, { provisional: true }))).toBe(false);
    expect(isGusty(score('calm', 5, 21, { hardGateTriggered: 'Rachas de 31 kt' }))).toBe(false);
    expect(isGusty(score('calm', 5, 21, { hardGateKind: 'wave' }))).toBe(false);
    expect(isGusty(score('calm', 5, null))).toBe(false);
    expect(isGusty(null)).toBe(false);
  });

  it('judges the gust the surface shows when it is given one', () => {
    expect(isGusty(score('calm', 5, 21), 12)).toBe(false);
    expect(isGusty(score('calm', 5, 12), 21)).toBe(true);
  });
});
