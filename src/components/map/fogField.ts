/**
 * The one look of fog on the map.
 *
 * Fog came from two overlays with a look each: FogOverlay around its detectors (cameras, solar signature,
 * official visibility) and a brighter halo around the official sensors. Nobody could tell them apart or say
 * why there were two, and both drew a grid of translucent squares, which read as a grey mosaic around the
 * airport. Now each one only works out WHERE the fog is, as points with a density on a regular lattice, and
 * FogOverlay paints the sum as one heatmap: soft edges, no cells, and a place both agree on is not painted twice.
 */
import { create } from 'zustand';
import type { Feature, Point } from 'geojson';

/** Distance between the sampled points. Fine enough to follow a valley floor, and a few hundred points per sensor. */
const FOG_POINT_KM = 0.4;
const KM_PER_DEG_LAT = 111;

/** How far each point reaches, in km. 3 x the lattice step: the kernel is a gaussian of a third of its radius,
 *  and any less shows the lattice as a pattern of dots. */
const FOG_REACH_KM = 1.2;
/** Pixels per km at zoom 0 at this latitude (~42 N). The heatmap radius is in pixels, the fog is not. */
const PX_PER_KM_Z0 = 256 / (40075 * Math.cos((42 * Math.PI) / 180));

export type FogPoint = Feature<Point, { density: number }>;

export function fogPoint(lng: number, lat: number, density: number): FogPoint {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { density } };
}

/** The lattice over a box: the same spacing on the ground whatever the size of the box. */
export function fogLattice(bbox: { west: number; east: number; south: number; north: number }): { lng: number; lat: number }[] {
  const stepLat = FOG_POINT_KM / KM_PER_DEG_LAT;
  const stepLng = stepLat / Math.cos((((bbox.south + bbox.north) / 2) * Math.PI) / 180);
  const out: { lng: number; lat: number }[] = [];
  for (let lat = bbox.south + stepLat / 2; lat < bbox.north; lat += stepLat) {
    for (let lng = bbox.west + stepLng / 2; lng < bbox.east; lng += stepLng) out.push({ lng, lat });
  }
  return out;
}

/** heatmap-radius that keeps the same reach on the ground at every zoom */
export const FOG_HEATMAP_RADIUS: ['interpolate', ['exponential', number], ['zoom'], number, number, number, number] = [
  'interpolate', ['exponential', 2], ['zoom'],
  6, FOG_REACH_KM * PX_PER_KM_Z0 * 2 ** 6,
  16, FOG_REACH_KM * PX_PER_KM_Z0 * 2 ** 16,
];

/**
 * A regular lattice under a gaussian kernel sums to 0.278 x (reach / step)^2 x weight, here 2.5 x weight, so
 * this makes a point of density 1 in the middle of its neighbours read as 1 in the colour ramp.
 */
export const FOG_HEATMAP_INTENSITY = 0.4;

/** Points of the official visibility sensors, published for FogOverlay to paint with its own. */
interface FogFieldState {
  sensorPoints: FogPoint[];
  setSensorPoints: (points: FogPoint[]) => void;
}

export const useFogFieldStore = create<FogFieldState>((set) => ({
  sensorPoints: [],
  setSensorPoints: (sensorPoints) => set({ sensorPoints }),
}));
