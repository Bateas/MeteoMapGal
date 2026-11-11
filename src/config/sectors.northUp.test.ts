import { describe, expect, it } from 'vitest';
import { SECTORS } from './sectors';

/**
 * The inland sector opened turned 15 degrees: a leftover of the tilted 3D view, on a map that is
 * flat since v2.97.0. Testers read it as «Galicia loads crooked» (11-nov). Every sector opens north up
 * and flat; wind arrows and «del NE» are read against the top of the screen.
 */
describe('sectors open north up and flat', () => {
  it.each(SECTORS.map((s) => [s.id, s] as const))('%s', (_id, sector) => {
    expect(sector.initialView.bearing).toBe(0);
    expect(sector.initialView.pitch).toBe(0);
  });
});
