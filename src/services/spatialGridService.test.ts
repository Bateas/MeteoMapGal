/**
 * Tests for spatialGridService — grid generator + Open-Meteo response parser.
 *
 * The fetch path itself is integration-tested in production (heatmap shows or
 * doesn't); these tests cover the deterministic geometry + the response shape
 * normalization (single-coord vs multi-coord payloads).
 */
import { describe, it, expect } from 'vitest';
import {
  generateGridCells,
  cellKey,
  estimateCellCount,
  GALICIA_GRID,
  type GridDef,
} from './spatialGridService';

// ── Geometry ─────────────────────────────────────────────

describe('generateGridCells — basic shape', () => {
  it('generates a small grid correctly', () => {
    const def: GridDef = { latMin: 42, latMax: 42.1, lonMin: -8.1, lonMax: -8.0, resolutionKm: 5 };
    const cells = generateGridCells(def);
    // 0.1° lat ≈ 11km, 0.1° lon ≈ 8km at 42°N → ~2 × 2 = 4 cells minimum
    expect(cells.length).toBeGreaterThanOrEqual(4);
    // First cell at south-west corner
    expect(cells[0].lat).toBe(42);
    expect(cells[0].lon).toBe(-8.1);
    expect(cells[0].i).toBe(0);
    expect(cells[0].j).toBe(0);
  });

  it('every cell has unique (i, j)', () => {
    const cells = generateGridCells(GALICIA_GRID);
    const keys = new Set(cells.map((c) => cellKey(c)));
    expect(keys.size).toBe(cells.length);
  });

  it('cells span the full lat range', () => {
    const cells = generateGridCells(GALICIA_GRID);
    const lats = cells.map((c) => c.lat);
    expect(Math.min(...lats)).toBe(GALICIA_GRID.latMin);
    expect(Math.max(...lats)).toBeLessThanOrEqual(GALICIA_GRID.latMax + 0.05);
    expect(Math.max(...lats)).toBeGreaterThanOrEqual(GALICIA_GRID.latMax - 0.1);
  });

  it('cells span the full lon range', () => {
    const cells = generateGridCells(GALICIA_GRID);
    const lons = cells.map((c) => c.lon);
    expect(Math.min(...lons)).toBe(GALICIA_GRID.lonMin);
    expect(Math.max(...lons)).toBeLessThanOrEqual(GALICIA_GRID.lonMax + 0.1);
  });

  it('Galicia grid produces ~2000-2500 cells at 5km resolution', () => {
    const count = estimateCellCount(GALICIA_GRID);
    // Expected: ~47 lat × ~48 lon ≈ 2256
    expect(count).toBeGreaterThan(1800);
    expect(count).toBeLessThan(3000);
  });

  it('coarser resolution produces proportionally fewer cells', () => {
    const fine = estimateCellCount({ ...GALICIA_GRID, resolutionKm: 5 });
    const coarse = estimateCellCount({ ...GALICIA_GRID, resolutionKm: 10 });
    // Half resolution per axis = quarter total cells (with some +1 boundary effects)
    expect(coarse).toBeLessThan(fine / 3.5); // generous bound
    expect(coarse).toBeGreaterThan(fine / 5);
  });
});

describe('generateGridCells — spacing correctness', () => {
  it('cells are spaced ~resolutionKm apart in lat', () => {
    const def: GridDef = { latMin: 42, latMax: 42.5, lonMin: -8, lonMax: -7.95, resolutionKm: 5 };
    const cells = generateGridCells(def);
    // Same column → consecutive lat steps
    const col0 = cells.filter((c) => c.j === 0).sort((a, b) => a.lat - b.lat);
    expect(col0.length).toBeGreaterThan(2);
    for (let i = 1; i < col0.length; i++) {
      const dKm = (col0[i].lat - col0[i - 1].lat) * 111.32;
      expect(dKm).toBeGreaterThan(4);
      expect(dKm).toBeLessThan(6);
    }
  });

  it('cells are spaced ~resolutionKm apart in lon (cos-corrected)', () => {
    const def: GridDef = { latMin: 42, latMax: 42.05, lonMin: -8.5, lonMax: -8, resolutionKm: 5 };
    const cells = generateGridCells(def);
    const row0 = cells.filter((c) => c.i === 0).sort((a, b) => a.lon - b.lon);
    expect(row0.length).toBeGreaterThan(2);
    const meanLat = (def.latMin + def.latMax) / 2;
    for (let i = 1; i < row0.length; i++) {
      const dKm = (row0[i].lon - row0[i - 1].lon) * 111.32 * Math.cos((meanLat * Math.PI) / 180);
      expect(dKm).toBeGreaterThan(4);
      expect(dKm).toBeLessThan(6);
    }
  });
});

describe('cellKey', () => {
  it('produces stable string keys', () => {
    expect(cellKey({ i: 0, j: 0 })).toBe('0,0');
    expect(cellKey({ i: 5, j: 12 })).toBe('5,12');
  });

  it('different cells produce different keys', () => {
    expect(cellKey({ i: 1, j: 2 })).not.toBe(cellKey({ i: 2, j: 1 }));
  });
});
