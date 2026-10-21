import { describe, it, expect } from 'vitest';
import { popupFitShift } from './PopupFit';

const frame = { top: 0, bottom: 900, left: 0, right: 1400 };
const m = { top: 110, bottom: 56, left: 12, right: 12 };

describe('popupFitShift (21-oct: a card opened above a spot near the top came out cut off)', () => {
  it('a card that fits is left alone', () => {
    expect(popupFitShift({ top: 200, bottom: 700, left: 300, right: 680 }, frame, m)).toEqual({ x: 0, y: 0 });
  });
  it('a card over the top edge pans the view up so it shows under the ticker', () => {
    expect(popupFitShift({ top: -150, bottom: 450, left: 300, right: 680 }, frame, m)).toEqual({ x: 0, y: -260 });
  });
  it('a card past the bottom pans down, but only if it fits at all', () => {
    expect(popupFitShift({ top: 500, bottom: 1000, left: 300, right: 680 }, frame, m)).toEqual({ x: 0, y: 156 });
    expect(popupFitShift({ top: 300, bottom: 1300, left: 300, right: 680 }, frame, m).y).toBe(0);
  });
  it('sides too', () => {
    expect(popupFitShift({ top: 200, bottom: 700, left: -40, right: 340 }, frame, m).x).toBe(-52);
    expect(popupFitShift({ top: 200, bottom: 700, left: 1200, right: 1450 }, frame, m).x).toBe(62);
  });
});
