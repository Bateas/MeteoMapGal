/**
 * The side of the long label of a silent buoy. Map symbols are drawn under the spot markers: «sin dato desde las 10:45»
 * over the Vigo tide gauge ran under the Bocana marker and read cut (25-nov, on a phone).
 */
import { describe, it, expect } from 'vitest';
import { labelSideAwayFromSpots, LABEL_CLASH_KM } from './buoyUtils';
import { RIAS_BUOY_STATIONS } from '../api/buoyClient';
import { getSpotsForSector } from '../config/spots';

const at = { lat: 42.24, lon: -8.73 };
const km = (north: number, east: number) => ({ lat: at.lat + north / 111.2, lon: at.lon + east / (111.2 * Math.cos((at.lat * Math.PI) / 180)) });

describe('labelSideAwayFromSpots', () => {
  it('stays over the buoy when no spot is near', () => {
    expect(labelSideAwayFromSpots(at, [])).toBe('above');
    expect(labelSideAwayFromSpots(at, [km(0, LABEL_CLASH_KM + 1), km(9, -9)])).toBe('above');
  });

  it('goes to the side opposite a spot that is close', () => {
    expect(labelSideAwayFromSpots(at, [km(2.8, 2.5)])).toBe('left');
    expect(labelSideAwayFromSpots(at, [km(1, -3)])).toBe('right');
  });

  it('the nearest of two decides', () => {
    expect(labelSideAwayFromSpots(at, [km(0.5, -5), km(2.8, 2.5)])).toBe('left');
    expect(labelSideAwayFromSpots(at, [km(0.5, -2), km(2.8, 2.5)])).toBe('right');
  });

  it('a spot clearly to the south is not in the way', () => {
    expect(labelSideAwayFromSpots(at, [km(-4, 1)])).toBe('above');
  });

  it('the Vigo tide gauge, with Bocana to its north-east: to the left', () => {
    const vigo = RIAS_BUOY_STATIONS.find((s) => s.id === 3221)!;
    const spots = getSpotsForSector('rias').map((s) => ({ lat: s.center[1], lon: s.center[0] }));
    expect(labelSideAwayFromSpots(vigo, spots)).toBe('left');
  });
});
