/**
 * The ring of arrows around a station is laid out again in steps of zoom. At half a level each step moved the
 * arrows by 41 %: a flicker around every station while zooming (25-nov, on a phone). The step is a quarter.
 */
import { describe, it, expect } from 'vitest';
import { windFieldZoom, WIND_FIELD_ZOOM_STEP } from './windFieldZoom';
import { buildWindFieldGeoJSON } from './WindFieldOverlay';
import type { NormalizedStation, NormalizedReading } from '../../types/station';

// Node modules through a string variable, as in repoGuards.test.ts: the app tsconfig carries no Node types.
const [fsModule, pathModule, urlModule] = ['node:fs', 'node:path', 'node:url'];
const { readFileSync } = await import(/* @vite-ignore */ fsModule);
const { join, dirname } = await import(/* @vite-ignore */ pathModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);
const overlay: string = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'WindFieldOverlay.tsx'), 'utf8');

const station: NormalizedStation = { id: 'mg_1', name: 'Uno', source: 'meteogalicia', lat: 42.2, lon: -8.7, altitude: 10 };
const reading = { stationId: 'mg_1', timestamp: new Date(), windSpeed: 5, windDirection: 270 } as NormalizedReading;

/** Distance in degrees of latitude from the station to its northern arrow, at a zoom. */
function ringRadius(zoom: number): number {
  const fc = buildWindFieldGeoJSON([station], new Map([[station.id, reading]]), [], false, zoom);
  const lats = fc.features.map((f) => (f.geometry as GeoJSON.Point).coordinates[1]);
  return Math.max(...lats) - station.lat;
}

describe('the zoom the ring of wind arrows is laid out for', () => {
  it('moves in quarters of a level', () => {
    expect(WIND_FIELD_ZOOM_STEP).toBe(0.25);
    expect(windFieldZoom(11)).toBe(11);
    expect(windFieldZoom(11.1)).toBe(11);
    expect(windFieldZoom(11.13)).toBe(11.25);
    expect(windFieldZoom(11.4)).toBe(11.5);
    expect(windFieldZoom(9.87)).toBe(9.75);
  });

  it('from one step to the next the ring moves by less than a fifth', () => {
    for (const zoom of [10, 11.25, 12.5, 13.75]) {
      const ratio = ringRadius(zoom) / ringRadius(zoom + WIND_FIELD_ZOOM_STEP);
      expect(ratio).toBeGreaterThan(1);
      expect(ratio).toBeLessThan(1.2);
    }
  });

  it('the layer rounds the zoom with this rule, at the start and on every zoom event', () => {
    expect(overlay.match(/windFieldZoom\(/g)?.length).toBe(2);
    expect(overlay).not.toMatch(/getZoom\(\)\s*\*\s*2\)\s*\/\s*2/);
  });
});
