/**
 * Magic Window Detector — rare convergence of optimal sailing signals.
 *
 * T2-2 (S136+3+3) bandera marketing: dispara cuando se alinean condiciones
 * que el usuario "no quiere perderse". A SAILORS' PERSPECTIVE — no a la
 * meteorólogo. La función vale lo que recomienda HACER:
 *
 *   • SW sinóptico fuerte (mouth buoys ≥10kt en 200-260°)
 *   • Boca con humedad alta (≥80% HR) → canalización confirmada en interior
 *   • Air-water ΔT positivo ≥3°C → motor térmico que reforzará el sinóptico
 *   • Hora térmica vigente (12-19h local)
 *   • Sin lightning/storms en proximidad inmediata (no contradicen)
 *
 * Score combinado 0-100; un score ≥75 dispara la ventana. Cuanto más cerca
 * de 100, más rara la alineación. Pure function — testable sin DB ni I/O.
 *
 * Returns null cuando no hay ventana, o el detalle estructurado cuando sí.
 *
 * Filosofía: NO duplicar la canalización Cesantes existente — esta detección
 * es SECTOR-WIDE (no per-spot). El user recibe "Ría de Vigo en ventana mágica
 * — todos los spots SW van a despertar en próximas 2h" no "Cesantes 14kt".
 */

import type { BuoyReading } from '../api/buoyClient';

// ── Types ────────────────────────────────────────────────────

export interface MagicWindowSignals {
  /** Found a mouth buoy with strong SW synoptic? */
  hasSynopticSW: boolean;
  /** Best mouth buoy wind in m/s (null if none qualifies) */
  synopticWindMs: number | null;
  /** Mouth buoy direction in deg */
  synopticDir: number | null;
  /** Mouth station relative humidity (%) — 75th percentile across mouth bbox */
  mouthHumidity: number | null;
  /** Water temperature near mouth (°C) — from buoy or null */
  waterTemp: number | null;
  /** Air temperature near coast (°C) — closest land station with temp */
  airTemp: number | null;
  /** Computed land-sea ΔT (air - water) in °C */
  deltaT: number | null;
  /** Hour 0-23 local time when evaluated */
  hour: number;
  /** Lightning strikes within sector (count last 15min) — 0 = clear */
  recentStrikesNearby: number;
}

export interface MagicWindowResult {
  /** Ventana mágica detectada (score ≥ THRESHOLD) */
  active: boolean;
  /** Score 0-100 — rarer alignment = higher */
  score: number;
  /** Sector this magic window applies to */
  sector: 'embalse' | 'rias';
  /** Per-signal contributions for debug + transparency */
  signals: MagicWindowSignals;
  /** Human-readable Spanish summary "Convergencia óptima detectada: …" */
  summary: string;
  /** Estimated duration in hours (rough — based on time-of-day + forecast trend) */
  estimatedHours: number;
  /** ISO timestamp when detection ran */
  detectedAt: string;
}

// ── Constants ────────────────────────────────────────────────

/** Magic window only meaningful for Rías sector — Embalse is thermal-only */
type Sector = 'embalse' | 'rias';

/** Mouth-of-ría buoy IDs (Vigo/Cabo Silleiro/A Guarda/Cíes) */
const MOUTH_BUOY_IDS = new Set([2248, 1252, 1253]);

/** SW direction window (broader than Cesantes detector — covers SW-SSW-S) */
const SW_DIR_MIN = 190;
const SW_DIR_MAX = 270;

/** Synoptic SW minimum wind speed (m/s) — ≥10kt */
const MIN_SYNOPTIC_MS = 5.1;

/** Thermal hour range (12-19h local) */
const THERMAL_HOUR_MIN = 12;
const THERMAL_HOUR_MAX = 19;

/** Minimum mouth humidity to confirm humid SW inflow */
const HIGH_MOUTH_HUMIDITY = 75;

/** Minimum land-sea ΔT for thermal motor */
const MIN_DELTA_T = 3;

/** Score threshold to activate the window */
export const MAGIC_WINDOW_THRESHOLD = 75;

/** If lightning ≥3 strikes in last 15min within 30km → SUPPRESS window
 *  (electrical activity contradicts "magic" — user should NOT plan a session) */
const LIGHTNING_VETO_COUNT = 3;

// ── Detector ─────────────────────────────────────────────────

/**
 * Build the magic window result given current signals.
 *
 * Score breakdown (0-100):
 *   - Synoptic SW present + speed normalized:    0-30
 *   - Mouth humidity confirms inflow:            0-20
 *   - Land-sea ΔT thermal motor:                 0-25
 *   - Thermal hour gate:                         0-15  (binary: 0 outside, 15 inside)
 *   - No nearby lightning:                       0-10  (binary: 10 if clear, 0 if storms)
 *
 * Cumulative ≥75 activates the window.
 */
export function evaluateMagicWindow(opts: {
  sector: Sector;
  buoys: BuoyReading[];
  mouthHumidity: number | null;
  airTempLocal: number | null;
  recentStrikesNearby: number;
  /** Override "now" hour for testing (0-23). Defaults to current local hour. */
  hour?: number;
}): MagicWindowResult | null {
  // Magic window only applies to Rías — Embalse is a different beast
  if (opts.sector !== 'rias') return null;

  const hour = opts.hour ?? new Date().getHours();

  // ── Find best mouth buoy with SW synoptic ──
  let synopticWindMs: number | null = null;
  let synopticDir: number | null = null;
  let waterTemp: number | null = null;
  for (const b of opts.buoys) {
    if (!MOUTH_BUOY_IDS.has(b.stationId)) continue;
    if (b.windSpeed != null && b.windDir != null) {
      if (b.windSpeed >= MIN_SYNOPTIC_MS && b.windDir >= SW_DIR_MIN && b.windDir <= SW_DIR_MAX) {
        if (synopticWindMs === null || b.windSpeed > synopticWindMs) {
          synopticWindMs = b.windSpeed;
          synopticDir = b.windDir;
        }
      }
    }
    // Capture mouth water temp (independent of wind qualifying)
    if (waterTemp === null && b.waterTemp != null) waterTemp = b.waterTemp;
  }

  const hasSynopticSW = synopticWindMs !== null;
  const deltaT = (opts.airTempLocal !== null && waterTemp !== null)
    ? opts.airTempLocal - waterTemp
    : null;

  const signals: MagicWindowSignals = {
    hasSynopticSW,
    synopticWindMs,
    synopticDir,
    mouthHumidity: opts.mouthHumidity,
    waterTemp,
    airTemp: opts.airTempLocal,
    deltaT,
    hour,
    recentStrikesNearby: opts.recentStrikesNearby,
  };

  // ── Lightning veto: ≥3 strikes nearby → no magic, period ──
  if (opts.recentStrikesNearby >= LIGHTNING_VETO_COUNT) {
    return {
      active: false,
      score: 0,
      sector: opts.sector,
      signals,
      summary: `Veto eléctrico: ${opts.recentStrikesNearby} rayos cerca, sin ventana.`,
      estimatedHours: 0,
      detectedAt: new Date().toISOString(),
    };
  }

  // ── Score computation ──
  let score = 0;

  // 1. Synoptic SW (0-30)
  if (hasSynopticSW && synopticWindMs !== null) {
    // 5.1 m/s → 15 points (just over min), 12 m/s → 30 points (cap)
    const speedScore = Math.min(30, 15 + ((synopticWindMs - MIN_SYNOPTIC_MS) / (12 - MIN_SYNOPTIC_MS)) * 15);
    score += Math.max(0, Math.round(speedScore));
  }

  // 2. Mouth humidity (0-20) — only counts if synoptic present (otherwise irrelevant)
  if (hasSynopticSW && opts.mouthHumidity !== null) {
    if (opts.mouthHumidity >= HIGH_MOUTH_HUMIDITY) {
      // 75% → 10pts, 90% → 20pts
      const humScore = Math.min(20, 10 + ((opts.mouthHumidity - HIGH_MOUTH_HUMIDITY) / 15) * 10);
      score += Math.round(humScore);
    }
  }

  // 3. Land-sea ΔT (0-25)
  if (deltaT !== null && deltaT >= MIN_DELTA_T) {
    // 3°C → 15pts, 6°C → 25pts (cap)
    const deltaScore = Math.min(25, 15 + ((deltaT - MIN_DELTA_T) / 3) * 10);
    score += Math.round(deltaScore);
  }

  // 4. Thermal hour (0-15) — binary gate
  if (hour >= THERMAL_HOUR_MIN && hour <= THERMAL_HOUR_MAX) {
    score += 15;
  }

  // 5. No nearby lightning (0-10) — binary
  if (opts.recentStrikesNearby === 0) {
    score += 10;
  } else if (opts.recentStrikesNearby < LIGHTNING_VETO_COUNT) {
    score += 5; // partial: some activity but below veto
  }

  // Thermal hour is a HARD GATE for active=true: without solar heating, there
  // is no thermal motor reinforcing the synoptic SW. The 15 hour-bonus points
  // would normally just bump score, but at high-signal pre-dawn cases the
  // score can cross threshold without the actual physics. Require BOTH
  // (score AND in-hour) to declare the window active.
  const inThermalHour = hour >= THERMAL_HOUR_MIN && hour <= THERMAL_HOUR_MAX;
  const active = score >= MAGIC_WINDOW_THRESHOLD && inThermalHour;

  // ── Build summary ──
  const summary = active
    ? buildActiveSummary(synopticWindMs, opts.mouthHumidity, deltaT, score)
    : buildInactiveSummary(signals, score);

  // ── Estimated hours ──
  // If we're in thermal hour AND have at least synoptic, estimate remaining
  // thermal window length (THERMAL_HOUR_MAX - current hour). Cap at 6h.
  const estimatedHours = active
    ? Math.min(6, Math.max(1, THERMAL_HOUR_MAX - hour + 1))
    : 0;

  return {
    active,
    score,
    sector: opts.sector,
    signals,
    summary,
    estimatedHours,
    detectedAt: new Date().toISOString(),
  };
}

function buildActiveSummary(
  windMs: number | null,
  hum: number | null,
  deltaT: number | null,
  score: number,
): string {
  const parts: string[] = [];
  if (windMs !== null) {
    const kt = windMs * 1.944;
    parts.push(`SW ${kt.toFixed(0)}kt en boca`);
  }
  if (hum !== null && hum >= HIGH_MOUTH_HUMIDITY) {
    parts.push(`HR boca ${hum.toFixed(0)}%`);
  }
  if (deltaT !== null && deltaT >= MIN_DELTA_T) {
    parts.push(`ΔT +${deltaT.toFixed(1)}°C`);
  }
  const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  // Mensaje tono "no te lo pierdas"
  return score >= 90
    ? `Ventana MÁGICA en Rías Baixas — alineación rara${detail}. Plan AHORA.`
    : `Ventana favorable en Rías Baixas${detail}. Score ${score}/100.`;
}

function buildInactiveSummary(s: MagicWindowSignals, score: number): string {
  const missing: string[] = [];
  if (!s.hasSynopticSW) missing.push('sin SW sinóptico en boca');
  if (s.mouthHumidity === null || s.mouthHumidity < HIGH_MOUTH_HUMIDITY) missing.push('HR boca insuficiente');
  if (s.deltaT === null || s.deltaT < MIN_DELTA_T) missing.push('ΔT insuficiente');
  if (s.hour < THERMAL_HOUR_MIN || s.hour > THERMAL_HOUR_MAX) missing.push('fuera de hora térmica');
  return `Sin ventana (score ${score}/${MAGIC_WINDOW_THRESHOLD}). Falta: ${missing.join(', ') || 'condiciones marginales'}.`;
}
