/**
 * DEM Water Mask — Reusable water/land grid from MapLibre terrain.
 *
 * Samples `map.queryTerrainElevation()` on a dense grid:
 *   - null or ≤0 → water
 *   - >0 → land
 *
 * Post-processing:
 *   1. **Coastal dilation**: land ≤3m next to ≥3 water cells → water
 *   2. **Noise erosion**: water cells with <2 water neighbors → land
 *   3. **Row-merge**: horizontal water runs → single rectangles (fewer features)
 *
 * Outputs:
 *   - **waterFill** — GeoJSON polygons for all water cells
 *   - **coastline** — GeoJSON LineStrings at water↔land edges
 *
 * Coastline is a reusable vector asset for: wave exposure, sea breeze,
 * upwelling visualization, and any marine overlay needing coast shape.
 */

// ── Types ────────────────────────────────────────────

export interface WaterMaskConfig {
  bbox: { west: number; east: number; south: number; north: number };
  cols: number;
  rows: number;
}

export type ElevationQuery = (lngLat: { lng: number; lat: number }) => number | null;

export interface WaterMaskResult {
  grid: boolean[][];
  waterFill: GeoJSON.FeatureCollection;
  coastline: GeoJSON.FeatureCollection;
  cellW: number;
  cellH: number;
  waterCells: number;
  landCells: number;
}

// ── Full Rías Baixas config — Portugal to Lira ───────

export const RIAS_WATER_CONFIG: WaterMaskConfig = {
  // Full Atlantic coast: Caminha (PT border) → Lira (north of Corrubedo)
  bbox: { west: -9.30, east: -8.35, south: 41.86, north: 42.80 },
  cols: 500,   // ~190m per cell
  rows: 500,   // ~210m per cell
};

// ── Constants ────────────────────────────────────────

const COAST_DILATION_MAX_ELEV = 3;
const MIN_WATER_NEIGHBORS = 2;
const DILATION_MIN_NEIGHBORS = 3; // stricter — avoids promoting random low fields

// ── Helpers ──────────────────────────────────────────

function countWaterNeighbors8(grid: boolean[][], row: number, col: number, rows: number, cols: number): number {
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr, c = col + dc;
      if (r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c]) n++;
    }
  }
  return n;
}

// ── Core ─────────────────────────────────────────────

export function sampleWaterMask(
  queryElevation: ElevationQuery,
  config: WaterMaskConfig,
): WaterMaskResult {
  const { bbox, cols, rows } = config;
  const cellW = (bbox.east - bbox.west) / cols;
  const cellH = (bbox.north - bbox.south) / rows;

  // ── Phase 1: Raw sample ──────────────────────────
  const rawGrid: boolean[][] = [];
  const elevGrid: (number | null)[][] = [];

  for (let row = 0; row < rows; row++) {
    rawGrid[row] = [];
    elevGrid[row] = [];
    for (let col = 0; col < cols; col++) {
      const lng = bbox.west + (col + 0.5) * cellW;
      const lat = bbox.south + (row + 0.5) * cellH;
      const elev = queryElevation({ lng, lat });
      elevGrid[row][col] = elev;
      rawGrid[row][col] = elev === null || elev <= 0;
    }
  }

  // ── Phase 2: Coastal dilation ────────────────────
  const grid: boolean[][] = rawGrid.map((r) => [...r]);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid[row][col]) continue;
      const elev = elevGrid[row][col];
      if (elev === null || elev > COAST_DILATION_MAX_ELEV) continue;
      if (countWaterNeighbors8(rawGrid, row, col, rows, cols) >= DILATION_MIN_NEIGHBORS) {
        grid[row][col] = true;
      }
    }
  }

  // ── Phase 3: Noise erosion ───────────────────────
  // Two passes — first erode, then re-check to clean clusters of 2
  for (let pass = 0; pass < 2; pass++) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (!grid[row][col]) continue;
        if (countWaterNeighbors8(grid, row, col, rows, cols) < MIN_WATER_NEIGHBORS) {
          grid[row][col] = false;
        }
      }
    }
  }

  // ── Phase 4: Row-merged water fill ───────────────
  let waterCells = 0;
  let landCells = 0;
  const waterFeatures: GeoJSON.Feature[] = [];

  for (let row = 0; row < rows; row++) {
    let runStart = -1;
    for (let col = 0; col <= cols; col++) {
      const isWater = col < cols && grid[row][col];
      if (isWater) {
        waterCells++;
        if (runStart < 0) runStart = col;
      } else {
        if (col < cols) landCells++;
        if (runStart >= 0) {
          const x1 = bbox.west + runStart * cellW;
          const x2 = bbox.west + col * cellW;
          const y1 = bbox.south + row * cellH;
          const y2 = y1 + cellH;
          waterFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]],
            },
            properties: { type: 'water' },
          });
          runStart = -1;
        }
      }
    }
  }

  // ── Phase 5: Coastline edges ─────────────────────
  const lineSegments: [number, number][][] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!grid[row][col]) continue;
      const x1 = bbox.west + col * cellW;
      const x2 = x1 + cellW;
      const y1 = bbox.south + row * cellH;
      const y2 = y1 + cellH;

      if (col + 1 >= cols || !grid[row][col + 1]) lineSegments.push([[x2, y1], [x2, y2]]);
      if (col === 0 || !grid[row][col - 1]) lineSegments.push([[x1, y1], [x1, y2]]);
      if (row + 1 >= rows || !grid[row + 1][col]) lineSegments.push([[x1, y2], [x2, y2]]);
      if (row === 0 || !grid[row - 1][col]) lineSegments.push([[x1, y1], [x2, y1]]);
    }
  }

  const CHUNK = 800;
  const coastlineFeatures: GeoJSON.Feature[] = [];
  for (let i = 0; i < lineSegments.length; i += CHUNK) {
    coastlineFeatures.push({
      type: 'Feature',
      geometry: {
        type: 'MultiLineString',
        coordinates: lineSegments.slice(i, i + CHUNK),
      },
      properties: { type: 'coastline' },
    });
  }

  return {
    grid,
    waterFill: { type: 'FeatureCollection', features: waterFeatures },
    coastline: { type: 'FeatureCollection', features: coastlineFeatures },
    cellW,
    cellH,
    waterCells,
    landCells,
  };
}

/**
 * Export coastline as downloadable GeoJSON string.
 * Call from browser console: copy(exportCoastlineGeoJSON(mask))
 */
export function exportCoastlineGeoJSON(result: WaterMaskResult): string {
  return JSON.stringify(result.coastline, null, 2);
}
