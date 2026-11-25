/**
 * Color utilities for SpotPopup sub-components.
 * Pure functions — no React, no side effects.
 */

/** Lightweight relative-time in Spanish */
export function timeAgoEs(ts: Date): string {
  const diff = Date.now() - ts.getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.round(mins / 60);
  return `hace ${hrs}h`;
}

/** Direction arrow character from degrees */
export function dirArrow(deg: number): string {
  const arrows = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];
  return arrows[Math.round(deg / 45) % 8];
}

/** Compass label from azimuth degrees */
export function azimuthLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}
