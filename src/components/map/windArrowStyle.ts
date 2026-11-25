import type maplibregl from 'maplibre-gl';

/**
 * Simple mode quiets the wind arrows so the spots lead: smaller and fainter, but with their colour, which is
 * the wind they read (decided 25-nov; a grey arrow said nothing).
 */
/** A little smaller only: at the stations' 0.7 a light-wind arrow was too small to read its colour. */
export const MUTED_ARROW_SCALE = 0.85;
export const MUTED_ARROW_OPACITY = 0.65;

/**
 * A zoom curve can only be the outermost expression, so the scale goes into each of its stops, never around it.
 */
export function arrowSize(base: maplibregl.ExpressionSpecification, muted: boolean): maplibregl.ExpressionSpecification {
  if (!muted) return base;
  const [op, curve, input, ...stops] = base as unknown[];
  return [op, curve, input, ...stops.map((v, i) => (i % 2 === 1 ? ['*', MUTED_ARROW_SCALE, v] : v))] as unknown as maplibregl.ExpressionSpecification;
}

const OPACITY: maplibregl.ExpressionSpecification = [
  'interpolate', ['linear'], ['get', 'speed'],
  0, 0.55,  // calm: still the quietest
  2, 0.85,  // light: has to read over rain and relief
  5, 0.95,  // moderate
  10, 1,    // strong
];

export function arrowOpacity(muted: boolean): maplibregl.ExpressionSpecification {
  return muted ? ['*', MUTED_ARROW_OPACITY, OPACITY] : OPACITY;
}
