/**
 * Shared color scales for marine buoy data visualization.
 * Used by BuoyMarker, BuoyPopup, and BuoyPanel to ensure
 * consistent coloring across all views.
 *
 * Wave height scale: WMO Sea State Code + Beaufort correlation.
 * Water temp scale: Galician Atlantic conditions (10–22°C typical range).
 */

// ── Wave height color (Hm0, meters) ────────────────────────
// Returns hex color string for inline styles.
// Scale: calm → slight → moderate → rough → high
export function waveHeightColor(h: number | null): string {
  if (h == null) return '#64748b';  // slate-500 (no data)
  if (h < 0.5) return '#22c55e';   // green — calm (Sea State 0-1)
  if (h < 1.0) return '#a3e635';   // lime — slight (Sea State 2)
  if (h < 2.0) return '#eab308';   // yellow — moderate (Sea State 3)
  if (h < 3.0) return '#f97316';   // orange — rough (Sea State 4)
  return '#ef4444';                // red — high (Sea State 5+)
}

// Tailwind class version for BuoyPanel data cells
export function waveHeightClass(h: number): string {
  if (h < 0.5) return 'text-green-400';
  if (h < 1.0) return 'text-lime-400';
  if (h < 2.0) return 'text-yellow-500';
  if (h < 3.0) return 'text-orange-400';
  return 'text-red-400';
}

// ── Water temperature color (°C) ───────────────────────────
// Galician Atlantic: 10–22°C typical range.
export function waterTempColor(t: number | null): string {
  if (t == null) return '#64748b';  // slate-500 (no data)
  if (t < 12) return '#3b82f6';    // blue — cold
  if (t < 15) return '#06b6d4';    // cyan — cool
  if (t < 18) return '#22c55e';    // green — mild
  if (t < 21) return '#eab308';    // yellow — warm
  return '#f97316';                // orange — very warm
}

// Tailwind class version for BuoyPanel data cells
export function waterTempClass(t: number): string {
  if (t < 12) return 'text-blue-400';
  if (t < 15) return 'text-cyan-400';
  if (t < 18) return 'text-green-400';
  if (t < 21) return 'text-yellow-500';
  return 'text-orange-400';
}

// ── Current speed color (m/s) ─────────────────────────────
// Galician rías: 0–0.5 m/s typical range.
export function currentSpeedColor(s: number | null): string {
  if (s == null) return '#64748b';    // slate-500 (no data)
  if (s < 0.05) return '#94a3b8';    // slate-400 — negligible
  if (s < 0.1) return '#2dd4bf';     // teal-400 — gentle
  if (s < 0.2) return '#06b6d4';     // cyan-500 — moderate
  if (s < 0.35) return '#0284c7';    // sky-600 — strong
  return '#7c3aed';                  // violet-600 — very strong
}

// Tailwind class version for BuoyPanel data cells
export function currentSpeedClass(s: number): string {
  if (s < 0.05) return 'text-slate-400';
  if (s < 0.1) return 'text-teal-400';
  if (s < 0.2) return 'text-cyan-400';
  if (s < 0.35) return 'text-sky-500';
  return 'text-violet-500';
}
