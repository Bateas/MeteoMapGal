/**
 * The centre of a station and of a buoy is painted with this scale, so one wrong step paints a mild day as a cold
 * one. Values written by hand: a break that swaps a comparison went through the suite green on 5-nov.
 */
import { describe, it, expect } from 'vitest';
import { temperatureColor } from './windUtils';

describe('temperature scale, step by step', () => {
  it('each band has its own colour', () => {
    expect(temperatureColor(-3)).toBe('#2a55c3');
    expect(temperatureColor(2)).toBe('#4c85e3');
    expect(temperatureColor(7)).toBe('#47b3cb');
    expect(temperatureColor(12)).toBe('#4fc06d');
    expect(temperatureColor(17)).toBe('#8dc84b');
    expect(temperatureColor(22)).toBe('#e2b64b');
    expect(temperatureColor(27)).toBe('#eb7e42');
    expect(temperatureColor(32)).toBe('#e05853');
    expect(temperatureColor(38)).toBe('#8e2d28');
  });

  it('the step is at the round figure: 19,9 is still green and 20 is already yellow', () => {
    expect(temperatureColor(19.9)).toBe('#8dc84b');
    expect(temperatureColor(20)).toBe('#e2b64b');
  });

  it('no reading is grey, never a temperature', () => {
    expect(temperatureColor(null)).toBe('#6b7280');
  });
});
