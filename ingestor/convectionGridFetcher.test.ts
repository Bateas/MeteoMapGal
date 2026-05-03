/**
 * Tests for convectionGridFetcher pure logic.
 * (Cycle integration is verified in production via log lines — needs DB.)
 */
import { describe, it, expect } from 'vitest';
import {
  generateGridCells,
  convectionRiskScore,
  parseGridResponses,
  GALICIA_GRID,
  type GridCell,
} from './convectionGridFetcher';

describe('generateGridCells', () => {
  it('produces a non-empty grid for Galicia at 10km', () => {
    const cells = generateGridCells(GALICIA_GRID);
    expect(cells.length).toBeGreaterThan(400);
    expect(cells.length).toBeLessThan(900); // sanity bounds at 10km
  });

  it('cells have stable (i, j) indexing', () => {
    const cells = generateGridCells({
      latMin: 42, latMax: 43, lonMin: -8, lonMax: -7, resolutionKm: 50,
    });
    expect(cells.length).toBeGreaterThan(0);
    // First cell should be (0, 0)
    expect(cells[0].i).toBe(0);
    expect(cells[0].j).toBe(0);
    // All cells inside bbox (with small tolerance for the +0.5 step)
    const def = { latMin: 42, latMax: 43, lonMin: -8, lonMax: -7 };
    for (const c of cells) {
      expect(c.lat).toBeGreaterThanOrEqual(def.latMin - 0.01);
      expect(c.lat).toBeLessThanOrEqual(def.latMax + 0.5);
      expect(c.lon).toBeGreaterThanOrEqual(def.lonMin - 0.01);
      expect(c.lon).toBeLessThanOrEqual(def.lonMax + 0.5);
    }
  });
});

describe('convectionRiskScore', () => {
  it('returns 0 when CAPE or LI is null', () => {
    expect(convectionRiskScore(null, -3)).toBe(0);
    expect(convectionRiskScore(1500, null)).toBe(0);
    expect(convectionRiskScore(null, null)).toBe(0);
  });

  it('returns 0 when CAPE < 200', () => {
    expect(convectionRiskScore(100, -5)).toBe(0);
    expect(convectionRiskScore(199, -10)).toBe(0);
  });

  it('returns 0 when LI > 0 (stable atmosphere)', () => {
    expect(convectionRiskScore(2000, 1)).toBe(0);
    expect(convectionRiskScore(2000, 5)).toBe(0);
  });

  it('matches documented examples', () => {
    expect(convectionRiskScore(1000, -2)).toBe(2);
    expect(convectionRiskScore(2000, -4)).toBe(8);
    expect(convectionRiskScore(3000, -6)).toBe(18);
  });

  it('clamps to 100 for extreme values', () => {
    expect(convectionRiskScore(10000, -20)).toBe(100);
  });
});

describe('parseGridResponses', () => {
  const cell: GridCell = { i: 0, j: 0, lat: 42.5, lon: -8.5 };

  it('returns empty when hourly is null for all cells', () => {
    const rows = parseGridResponses([{ cell, hourly: null }]);
    expect(rows).toEqual([]);
  });

  it('parses one row per hour with non-null values', () => {
    const rows = parseGridResponses([{
      cell,
      hourly: {
        time: ['2026-05-03T14:00:00Z', '2026-05-03T15:00:00Z'],
        cape: [1500, 2000],
        lifted_index: [-3, -4],
        convective_inhibition: [10, 5],
        boundary_layer_height: [1200, 1400],
        precipitation: [0.5, 8.2],
      },
    }]);
    expect(rows).toHaveLength(2);
    expect(rows[0].cape).toBe(1500);
    expect(rows[0].liftedIndex).toBe(-3);
    expect(rows[0].precipMm).toBe(0.5);
    expect(rows[0].risk).toBe(4.5); // 1500 * 3 / 1000
    expect(rows[1].precipMm).toBe(8.2);
    expect(rows[1].risk).toBe(8); // 2000 * 4 / 1000
  });

  it('skips hours where every variable is null (no DB write waste)', () => {
    const rows = parseGridResponses([{
      cell,
      hourly: {
        time: ['2026-05-03T14:00:00Z'],
        cape: [null],
        lifted_index: [null],
        convective_inhibition: [null],
        boundary_layer_height: [null],
        precipitation: [null],
      },
    }]);
    expect(rows).toEqual([]);
  });

  it('keeps row when ONLY precip is present (rainy day, low CAPE)', () => {
    const rows = parseGridResponses([{
      cell,
      hourly: {
        time: ['2026-05-03T14:00:00Z'],
        cape: [null],
        lifted_index: [null],
        convective_inhibition: [null],
        boundary_layer_height: [null],
        precipitation: [3.2],
      },
    }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].precipMm).toBe(3.2);
    expect(rows[0].risk).toBe(0); // no CAPE → risk 0, but rain still tracked
  });

  it('preserves cell index info', () => {
    const c2: GridCell = { i: 5, j: 7, lat: 43.0, lon: -7.5 };
    const rows = parseGridResponses([{
      cell: c2,
      hourly: {
        time: ['2026-05-03T14:00:00Z'],
        cape: [800],
        lifted_index: [-1],
        convective_inhibition: [50],
        boundary_layer_height: [900],
      },
    }]);
    expect(rows[0].cellI).toBe(5);
    expect(rows[0].cellJ).toBe(7);
    expect(rows[0].lat).toBe(43.0);
    expect(rows[0].lon).toBe(-7.5);
  });

  it('skips invalid timestamps', () => {
    const rows = parseGridResponses([{
      cell,
      hourly: {
        time: ['invalid-date', '2026-05-03T15:00:00Z'],
        cape: [1500, 2000],
        lifted_index: [-3, -4],
        convective_inhibition: [10, 5],
        boundary_layer_height: [1200, 1400],
      },
    }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cape).toBe(2000);
  });
});
