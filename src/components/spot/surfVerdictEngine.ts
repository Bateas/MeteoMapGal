/**
 * Surf Verdict Engine — wave-based scoring for surf spots.
 *
 * Base level from wave height:
 *   Flat (<0.3m) → Peque (0.3-0.8m) → Surf OK (0.8-1.5m) → Clasico (1.5-2.5m) → Grande (>2.5m)
 *
 * Modifiers (cap +1 total):
 *   - Offshore wind: +1 (olas limpias)
 *   - Onshore wind: -1 (mar revuelto)
 *   - Swell period >=10s + aligned: +1 (swell de calidad)
 *   - Short period <5s: -1 (mar de viento)
 *
 * Hard floors:
 *   - CLASICO needs >= 1.0m effective waves
 *   - GRANDE needs >= 1.8m effective waves
 */

export interface SurfVerdictResult {
  label: string;
  color: string;
  bg: string;
  summary: string;
}

const LEVELS: SurfVerdictResult[] = [
  { label: 'FLAT',      color: '#94a3b8', bg: 'rgba(100,116,139,0.15)', summary: 'Mar plano — sin olas para surf' },
  { label: 'PEQUE',     color: '#22d3ee', bg: 'rgba(34,211,238,0.12)',  summary: 'Olas pequeñas — ideal para longboard o iniciarse' },
  { label: 'SURF OK',   color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  summary: 'Buen día para meterse — olas surfeables' },
  { label: 'CLASICO',   color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   summary: 'Día clásico — olas limpias y consistentes' },
  { label: 'GRANDE',    color: '#f97316', bg: 'rgba(249,115,22,0.12)',  summary: 'Mar grande — solo con experiencia' },
];

/**
 * Compute how well a swell direction aligns with a beach orientation.
 * Returns a multiplier 0.3→1.0:
 *   - Frontal swell (0° diff) = 1.0
 *   - 45° angle = ~0.85
 *   - 90° lateral = 0.5
 *   - Behind the beach (>120°) = 0.3
 *
 * Use to adjust coastalFactor dynamically: effectiveFactor = baseFactor × alignment
 */
export function swellAlignmentMultiplier(swellDir: number, beachOrientation: number): number {
  // Beach faces beachOrientation degrees — swell should come FROM that direction
  // Angle between swell direction and beach face
  const diff = Math.abs(((swellDir - beachOrientation + 540) % 360) - 180);
  // cos-based decay: 0° = 1.0, 90° = 0.5, 180° = 0.3
  if (diff <= 90) return 1.0 - (diff / 90) * 0.5; // 1.0 → 0.5
  return 0.3; // behind the beach — minimal exposure
}

export function computeSurfVerdict(
  waveHeight: number,
  period: number,
  isOffshore: boolean,
  isOnshore: boolean,
  swellAligned = true,
): SurfVerdictResult {
  // Base wave level (0-4) — determined by ACTUAL wave height
  let level: number;
  if (waveHeight < 0.3) level = 0;       // FLAT
  else if (waveHeight < 0.8) level = 1;  // PEQUE
  else if (waveHeight < 1.5) level = 2;  // SURF OK
  else if (waveHeight < 2.5) level = 3;  // CLASICO
  else level = 4;                         // GRANDE

  const baseLevel = level;
  const warnings: string[] = [];
  let bonus = 0;

  // Wind quality (affects wave cleanliness, not size)
  if (isOffshore && level > 0) {
    bonus += 1;
    warnings.push('viento offshore (olas limpias)');
  }
  if (isOnshore && level > 0) {
    bonus -= 1;
    warnings.push('viento onshore (mar revuelto)');
  }

  // Period quality — only bonus if swell direction aligns with beach
  if (period >= 10 && level >= 1 && swellAligned) {
    bonus += 1;
    warnings.push(`periodo ${period.toFixed(0)}s (swell de calidad)`);
  } else if (period >= 10 && level >= 1 && !swellAligned) {
    warnings.push(`periodo ${period.toFixed(0)}s (swell cruzado)`);
  } else if (period > 0 && period < 5 && level >= 1) {
    bonus -= 1;
    warnings.push(`periodo ${period.toFixed(0)}s (mar de viento)`);
  }

  // Apply bonus but CAP at +1 from base
  level = Math.max(0, Math.min(4, baseLevel + Math.max(-2, Math.min(1, bonus))));

  // Hard floors: modifiers can't create size that isn't there
  if (level >= 3 && waveHeight < 1.0) level = 2; // CLASICO needs >= 1.0m
  if (level === 4 && waveHeight < 1.8) level = 3; // GRANDE needs >= 1.8m

  const result = { ...LEVELS[level] };

  // Technical detail line
  const detail: string[] = [];
  detail.push(`${waveHeight.toFixed(1)}m`);
  if (period > 0) detail.push(`${period.toFixed(0)}s`);
  if (warnings.length > 0) detail.push(warnings.join(', '));
  result.summary += ` (${detail.join(' \u00b7 ')})`;

  return result;
}
