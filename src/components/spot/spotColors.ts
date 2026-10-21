/**
 * Color utilities for SpotPopup sub-components.
 * Pure functions — no React, no side effects.
 */

/** Wave bar color for the surf «Olas 24h» strip: the same bands and colours as the surf verdict's
 *  base level (surfVerdictEngine: FLAT <0,3 · PEQUE <0,8 · SURF OK <1,5 · CLÁSICO <2,5 · GRANDE). */
export function waveBarColor(m: number): string {
  if (m < 0.3) return 'rgba(100,116,139,0.45)'; // FLAT
  if (m < 0.8) return 'rgba(34,211,238,0.55)';  // PEQUE
  if (m < 1.5) return 'rgba(59,130,246,0.65)';  // SURF OK
  if (m < 2.5) return 'rgba(34,197,94,0.7)';    // CLÁSICO
  return 'rgba(249,115,22,0.8)';                 // GRANDE
}

/** Wind speed color aligned with verdict thresholds */
export function windKtColor(kt: number): string {
  if (kt < 6) return '#94a3b8';   // calm — slate
  if (kt < 8) return '#38bdf8';   // flojo — sky blue
  if (kt < 13) return '#22c55e';  // navegable — green
  if (kt < 18) return '#eab308';  // bueno — yellow
  if (kt < 23) return '#f97316';  // fuerte — orange
  if (kt < 30) return '#ef4444';  // gale — red
  if (kt < 40) return '#a855f7';  // storm — violet
  if (kt < 50) return '#7c3aed';  // severe storm — dark violet
  return '#1e1b4b';               // hurricane — near-black
}

export function humidityColor(h: number): string {
  if (h < 40) return '#fbbf24';
  if (h < 60) return '#34d399';
  if (h < 80) return '#60a5fa';
  return '#a78bfa';
}

export function waterTColor(t: number): string {
  if (t < 13) return '#60a5fa';
  if (t < 16) return '#22d3ee';
  if (t < 20) return '#34d399';
  return '#fbbf24';
}

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
