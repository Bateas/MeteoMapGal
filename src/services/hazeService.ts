/**
 * Haze / calima severity classifier.
 *
 * Pure function — given Open-Meteo Air Quality current values, returns a
 * three-level severity for visual overlay.
 *
 * Calima = Saharan dust event affecting the Iberian peninsula. Reduces
 * visibility, deposits brownish-orange particulate, raises PM10/PM2.5 well
 * above background, and crucially raises atmospheric AOD.
 *
 * Thresholds derived from AEMET calima episodes 2020-2024 and Open-Meteo
 * CAMS aerosol model conventions.
 */

export type HazeSeverity = 'none' | 'leve' | 'moderada' | 'fuerte';

export interface HazeAssessment {
  severity: HazeSeverity;
  /** Brownish RGB tint as `[r, g, b]` 0-255, or null when severity = none */
  tint: [number, number, number] | null;
  /** Fill opacity 0-1 for overlay, scaled to severity */
  opacity: number;
  /** Short label for UI badges */
  label: string;
}

/**
 * Classify haze severity from current air quality readings.
 *
 * Inputs:
 * - dust: μg/m³ (Saharan dust component, from Open-Meteo CAMS aerosol model)
 * - aod: aerosol_optical_depth (dimensionless, 0=clear, >1=heavy haze)
 * - minVisibilityKm (optional, S126): worst visibility currently reported by
 *   any AEMET airport station. Acts as OFFICIAL EVIDENCE that bumps severity
 *   when the model already detected something:
 *     · vis<5km + any model leve+ → at least 'moderada'
 *     · vis<2km + any model leve+ → 'fuerte'
 *   Visibility reduction WITHOUT model detection is NOT enough — could be fog
 *   or rain. The model has to corroborate. Multi-evidence override pattern
 *   (same logic as the fog detector S122).
 *
 * Both dust+AOD null/0 → `none`. Either signal can promote severity; we take
 * the higher of the two (worst-case) to avoid masking calima when one
 * variable is missing.
 */
export function classifyHaze(
  dust: number | null | undefined,
  aod: number | null | undefined,
  minVisibilityKm?: number | null,
): HazeAssessment {
  const d = dust ?? 0;
  const a = aod ?? 0;

  // Severity per signal
  let dustLevel: HazeSeverity = 'none';
  if (d >= 100) dustLevel = 'fuerte';
  else if (d >= 50) dustLevel = 'moderada';
  else if (d >= 25) dustLevel = 'leve';

  let aodLevel: HazeSeverity = 'none';
  if (a >= 0.7) aodLevel = 'fuerte';
  else if (a >= 0.4) aodLevel = 'moderada';
  else if (a >= 0.25) aodLevel = 'leve';

  // Model-derived severity (Open-Meteo only)
  let severity = maxSeverity(dustLevel, aodLevel);

  // S126 multi-evidence bump from official AEMET visibility.
  // ONLY applies when the model already detected calima (severity != none).
  // Reduced visibility with a clean model is more likely fog/rain than dust.
  if (severity !== 'none' && minVisibilityKm != null && Number.isFinite(minVisibilityKm)) {
    if (minVisibilityKm < 2) {
      // Strong corroboration → max severity
      severity = 'fuerte';
    } else if (minVisibilityKm < 5 && severity === 'leve') {
      // Moderate corroboration → at least moderada
      severity = 'moderada';
    }
  }

  const tint: [number, number, number] | null = severity === 'none' ? null : [180, 130, 70]; // brownish ochre

  // Opacity scales with severity but stays subtle so the map remains readable
  let opacity = 0;
  if (severity === 'leve') opacity = 0.06;
  else if (severity === 'moderada') opacity = 0.12;
  else if (severity === 'fuerte') opacity = 0.22;

  let label = '';
  if (severity === 'leve') label = 'Calima leve';
  else if (severity === 'moderada') label = 'Calima moderada';
  else if (severity === 'fuerte') label = 'Calima fuerte';

  return { severity, tint, opacity, label };
}

const RANK: Record<HazeSeverity, number> = { none: 0, leve: 1, moderada: 2, fuerte: 3 };

function maxSeverity(a: HazeSeverity, b: HazeSeverity): HazeSeverity {
  return RANK[a] >= RANK[b] ? a : b;
}
