/**
 * Color utilities for SpotPopup sub-components.
 * Pure functions — no React, no side effects.
 */

/** Wave bar color for mini forecast chart */
export function waveBarColor(m: number): string {
  if (m < 0.5) return 'rgba(100,116,139,0.4)'; // flat — grey
  if (m < 1.0) return 'rgba(34,211,238,0.5)';  // small — cyan
  if (m < 1.5) return 'rgba(56,189,248,0.6)';  // medium — sky
  if (m < 2.5) return 'rgba(59,130,246,0.7)';  // good — blue
  if (m < 4.0) return 'rgba(234,179,8,0.7)';   // big — yellow
  return 'rgba(239,68,68,0.8)';                  // huge — red
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

export function waveColor(m: number): string {
  if (m < 0.5) return '#94a3b8';
  if (m < 1.0) return '#34d399';
  if (m < 2.0) return '#fbbf24';
  return '#f87171';
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
