/**
 * Tests for meteoGaliciaIcaClient — pure helper coverage.
 *
 * The fetcher itself is network-bound (skipped in CI). Here we test the
 * `icaCategory` bucketing only — that's the part that affects UI display
 * and could silently misclassify air quality.
 */

import { describe, it, expect } from 'vitest';
import { icaCategory } from './meteoGaliciaIcaClient';

describe('icaCategory — ICA value bucketing', () => {
  it('returns unknown for NaN', () => {
    expect(icaCategory(NaN)).toBe('unknown');
  });

  it('returns unknown for Infinity', () => {
    expect(icaCategory(Infinity)).toBe('unknown');
  });

  it('buena for <1.5', () => {
    expect(icaCategory(1)).toBe('buena');
    expect(icaCategory(1.49)).toBe('buena');
  });

  it('aceptable for 1.5-2.49', () => {
    expect(icaCategory(1.5)).toBe('aceptable');
    expect(icaCategory(2)).toBe('aceptable');
    expect(icaCategory(2.49)).toBe('aceptable');
  });

  it('deficiente for 2.5-3.49', () => {
    expect(icaCategory(2.5)).toBe('deficiente');
    expect(icaCategory(3)).toBe('deficiente');
    expect(icaCategory(3.49)).toBe('deficiente');
  });

  it('mala for 3.5-4.49', () => {
    expect(icaCategory(3.5)).toBe('mala');
    expect(icaCategory(4)).toBe('mala');
    expect(icaCategory(4.49)).toBe('mala');
  });

  it('muy_mala for ≥4.5', () => {
    expect(icaCategory(4.5)).toBe('muy_mala');
    expect(icaCategory(5)).toBe('muy_mala');
  });

  it('handles real-world live values from ICA API', () => {
    // From the ICA REST endpoint at the time of writing
    expect(icaCategory(1.5866)).toBe('aceptable');
    expect(icaCategory(1.7634)).toBe('aceptable');
    expect(icaCategory(1.83)).toBe('aceptable');
    expect(icaCategory(1.35)).toBe('buena');
  });
});
