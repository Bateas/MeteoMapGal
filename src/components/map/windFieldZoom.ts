/**
 * The zoom the ring of arrows around a station is laid out for.
 *
 * The six arrows sit at a distance from the station fixed in degrees, re-scaled as the map zooms so the
 * ring keeps about the same size on screen. Re-scaling on every zoom event would rebuild the layer many
 * times a second, so the zoom is rounded to a step and the ring is laid out again only when the step
 * changes. Each change moves the arrows by 2^step: at half a level that is 41 %, a jump the eye catches
 * as a flicker around every station (25-nov, on a phone). At a quarter it is 19 %.
 */
export const WIND_FIELD_ZOOM_STEP = 0.25;

export function windFieldZoom(zoom: number): number {
  return Math.round(zoom / WIND_FIELD_ZOOM_STEP) * WIND_FIELD_ZOOM_STEP;
}
