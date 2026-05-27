/**
 * Downburst Risk detector — dry microburst / wind shear warning.
 *
 * T3-2 (S136+3+3 fase 1). Detects the atmospheric setup that produces
 * sudden severe surface gusts under cumulonimbus, even WITHOUT visible
 * precipitation reaching the ground. Critical for aviación (Castrelo
 * area, ENAIRE), náutica deportiva (small craft can capsize in <30s) and
 * windsurf/kite (line failures).
 *
 * Setup that produces dry downbursts:
 *   1. Surface gust ratio elevated — at least one station with
 *      `gust/avgWind ≥ 2.0` already shows wind shear at ground.
 *   2. Cold mid-troposphere — `temperature_500hPa ≤ -15°C` means falling
 *      cold air parcels accelerate the descent (drier, denser).
 *   3. Convective instability — CAPE ≥ 800 J/kg and LI ≤ -2 → enough
 *      energy for vertical motion.
 *   4. Dry sub-cloud layer — high cloud cover (≥70%) but precipitation
 *      LOW (≤0.5 mm/h). Rain evaporates as it falls through dry air,
 *      cooling further → accelerating descent → surface gust spike.
 *
 * When all 4 align → 'high' severity. With 3 of 4 → 'moderate'.
 * Below 3 → null (not actionable).
 *
 * Pure function, no I/O. Called from AppShell alert pipeline + ingestor
 * analyzer (future phase) to surface in ticker + Telegram.
 */

export interface DownburstSignals {
  /** Best gust-to-avg ratio observed across nearby stations */
  maxGustRatio: number | null;
  /** Station ID that produced the worst gust ratio (for traceability) */
  gustSourceStation: string | null;
  /** Temperature at 500 hPa (°C) — colder = more descent acceleration */
  temperature500hPa: number | null;
  /** CAPE (J/kg) — convective energy available */
  cape: number | null;
  /** Lifted Index (°C, negative = unstable) */
  liftedIndex: number | null;
  /** Cloud cover (%) — high cloud + dry below = dry downburst setup */
  cloudCover: number | null;
  /** Precipitation rate (mm/h) — low precip = dry, high = wet downburst */
  precipMmH: number | null;
}

export interface DownburstRisk {
  /** Severity: null = no actionable risk, 'moderate'/'high' = act */
  severity: 'moderate' | 'high' | null;
  /** Confidence 0-100% (number of signals that align) */
  confidence: number;
  /** Spanish summary of the conditions for the alert */
  summary: string;
  /** Per-signal breakdown for debug + transparency */
  signals: DownburstSignals;
  /** How many of the 4 signals are firing */
  alignedCount: number;
}

// ── Thresholds (calibrated for Galician downbursts) ─────────

const GUST_RATIO_THRESHOLD = 2.0;
const T500_COLD_THRESHOLD = -15; // °C
const CAPE_MIN = 800; // J/kg
const LI_MAX = -2; // °C, more negative = more unstable
const CLOUD_HIGH_THRESHOLD = 70; // %
const PRECIP_DRY_MAX = 0.5; // mm/h — above this is wet, not dry

// ── Public API ──────────────────────────────────────────────

interface StationGust {
  stationId: string;
  windSpeed: number; // m/s
  windGust: number; // m/s
}

/**
 * Evaluate downburst risk from current signals.
 *
 * @param stations Surface stations with wind + gust (m/s). The detector
 *                 finds the station with the worst gust ratio.
 * @param atmosphere Mid-troposphere + convection state (typically the
 *                   nearest hourly forecast bucket).
 */
export function evaluateDownburstRisk(opts: {
  stations: StationGust[];
  atmosphere: {
    temperature500hPa: number | null;
    cape: number | null;
    liftedIndex: number | null;
    cloudCover: number | null;
    precipMmH: number | null;
  };
}): DownburstRisk {
  // ── Signal 1: surface gust ratio ──
  let maxGustRatio: number | null = null;
  let gustSourceStation: string | null = null;
  for (const s of opts.stations) {
    if (s.windSpeed <= 0.5 || s.windGust <= 0) continue;
    const ratio = s.windGust / s.windSpeed;
    if (maxGustRatio === null || ratio > maxGustRatio) {
      maxGustRatio = ratio;
      gustSourceStation = s.stationId;
    }
  }

  // ── Signals 2-4: pull from atmosphere ──
  const { temperature500hPa, cape, liftedIndex, cloudCover, precipMmH } = opts.atmosphere;

  const sig1_gustElevated = maxGustRatio !== null && maxGustRatio >= GUST_RATIO_THRESHOLD;
  const sig2_t500Cold = temperature500hPa !== null && temperature500hPa <= T500_COLD_THRESHOLD;
  const sig3_unstable = (cape !== null && cape >= CAPE_MIN) && (liftedIndex !== null && liftedIndex <= LI_MAX);
  const sig4_dryProfile = (cloudCover !== null && cloudCover >= CLOUD_HIGH_THRESHOLD)
    && (precipMmH !== null && precipMmH <= PRECIP_DRY_MAX);

  const alignedCount = [sig1_gustElevated, sig2_t500Cold, sig3_unstable, sig4_dryProfile]
    .filter(Boolean).length;

  const signals: DownburstSignals = {
    maxGustRatio,
    gustSourceStation,
    temperature500hPa,
    cape,
    liftedIndex,
    cloudCover,
    precipMmH,
  };

  if (alignedCount < 3) {
    return {
      severity: null,
      confidence: alignedCount * 25,
      summary: alignedCount === 0
        ? 'Sin condiciones de downburst.'
        : `Setup incompleto (${alignedCount}/4 señales).`,
      signals,
      alignedCount,
    };
  }

  const severity: 'moderate' | 'high' = alignedCount === 4 ? 'high' : 'moderate';
  const confidence = alignedCount === 4 ? 90 : 65;

  const reasons: string[] = [];
  if (sig1_gustElevated && maxGustRatio !== null) {
    reasons.push(`rachas ×${maxGustRatio.toFixed(1)} en ${gustSourceStation ?? 'estación'}`);
  }
  if (sig2_t500Cold && temperature500hPa !== null) {
    reasons.push(`aire frío ${temperature500hPa.toFixed(0)}°C en altura`);
  }
  if (sig3_unstable && cape !== null && liftedIndex !== null) {
    reasons.push(`atmósfera inestable (CAPE ${cape.toFixed(0)}, LI ${liftedIndex.toFixed(1)})`);
  }
  if (sig4_dryProfile && cloudCover !== null && precipMmH !== null) {
    reasons.push(`nube alta + capa baja seca (cob ${cloudCover.toFixed(0)}%, lluvia ${precipMmH.toFixed(1)}mm/h)`);
  }

  const severityLabel = severity === 'high' ? 'Riesgo ALTO' : 'Riesgo moderado';
  const summary = `${severityLabel} de downburst seco — ${reasons.join(', ')}. Rachas súbitas posibles sin lluvia visible.`;

  return {
    severity,
    confidence,
    summary,
    signals,
    alignedCount,
  };
}
