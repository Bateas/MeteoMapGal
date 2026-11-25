import { describe, it, expect } from 'vitest';
import { spotFitsSector, getSpotsForSector } from './spots';

describe('spotFitsSector (P3 review, 19-nov: a remembered spot of the other sector stayed selected)', () => {
  it('nothing selected always fits', () => {
    expect(spotFitsSector('', 'embalse')).toBe(true);
  });
  it('a spot fits its own sector and not the other one', () => {
    const rias = getSpotsForSector('rias')[0].id;
    const embalse = getSpotsForSector('embalse')[0].id;
    expect(spotFitsSector(rias, 'rias')).toBe(true);
    expect(spotFitsSector(rias, 'embalse')).toBe(false);
    expect(spotFitsSector(embalse, 'rias')).toBe(false);
  });
  it('an id that no longer exists does not fit anywhere', () => {
    expect(spotFitsSector('spot-borrado', 'rias')).toBe(false);
  });
});
