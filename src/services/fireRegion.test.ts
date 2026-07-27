import { describe, it, expect } from 'vitest';
import {
  fireRegion,
  fireDisclaimer,
  describeFireLocation,
  BURN_PLAUSIBLE_MAX_MW,
} from './fireRegion';

describe('fireRegion', () => {
  it('names the Galician province and marks it as here', () => {
    // Ourense city
    expect(fireRegion(42.34, -7.86)).toEqual({ label: 'Ourense', inGalicia: true });
    // Vigo
    expect(fireRegion(42.24, -8.72)?.label).toBe('Pontevedra');
    // A Coruña city
    expect(fireRegion(43.36, -8.41)?.label).toBe('A Coruña');
  });

  it('names the neighbours without claiming them as Galicia', () => {
    // The 564 MW fire the user saw: south of the border, near Porto
    const porto = fireRegion(41.2, -8.3);
    expect(porto?.label).toBe('el norte de Portugal');
    expect(porto?.inGalicia).toBe(false);

    // Bragança / Zamora border, the one that was being announced from 178km
    expect(fireRegion(41.89, -6.59)?.inGalicia).toBe(false);
  });

  it('returns null well outside the covered area rather than guessing', () => {
    expect(fireRegion(37.4, -5.9)).toBeNull(); // Sevilla
    expect(fireRegion(48.8, 2.3)).toBeNull(); // Paris
  });

  it('returns null for unusable coordinates', () => {
    expect(fireRegion(Number.NaN, -8.0)).toBeNull();
    expect(fireRegion(42.0, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('fireDisclaimer', () => {
  it('allows for an authorised burn only while the power makes that possible', () => {
    const small = fireDisclaimer(4);
    expect(small).toContain('quema autorizada');
    expect(small).toContain('agrícola');
  });

  it('stops offering a farm burn as a possibility for a hundreds-of-megawatts fire', () => {
    // The exact case that made the popup incoherent: 564 MW described as
    // possibly an agricultural burn. The wording may still mention a burn —
    // but only to rule it out, never as one of the options.
    const big = fireDisclaimer(564);
    expect(big).not.toContain('Puede ser');
    expect(big).not.toContain('quema autorizada');
    expect(big).toContain('no es una quema');
    // Still refuses to claim it is confirmed
    expect(big).toContain('sin confirmación oficial');
  });

  it('switches at the documented threshold', () => {
    expect(fireDisclaimer(BURN_PLAUSIBLE_MAX_MW - 0.1)).toContain('quema autorizada');
    expect(fireDisclaimer(BURN_PLAUSIBLE_MAX_MW)).not.toContain('quema autorizada');
  });

  it('keeps the cautious wording when there is no usable power reading', () => {
    expect(fireDisclaimer(0)).toContain('quema autorizada');
    expect(fireDisclaimer(Number.NaN)).toContain('quema autorizada');
  });
});

describe('describeFireLocation', () => {
  it('leads with the place, not with the reservoir it is far from', () => {
    // The line the user objected to: "A 125 km al sur de Embalse de Castrelo"
    const line = describeFireLocation(41.2, -8.3, 125, 'sur');
    expect(line).toBe('En el norte de Portugal, a 125 km');
    expect(line).not.toContain('Castrelo');
  });

  it('names a Galician province when the fire is here', () => {
    expect(describeFireLocation(42.34, -7.86, 20, 'este')).toBe('En Ourense, a 20 km');
  });

  it('falls back to distance and bearing outside the named boxes', () => {
    expect(describeFireLocation(37.4, -5.9, 480, 'sureste')).toBe('A 480 km al sureste');
  });
});
