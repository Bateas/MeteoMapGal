/**
 * Documented orographic / siting biases for weather stations in the
 * Galician network.
 *
 * Even "official" AEMET / MeteoGalicia stations have characteristic
 * blind sectors and distortions caused by their physical location:
 * a station at the foot of a mountain underreads winds blowing TOWARD
 * that mountain; a station in a valley channels flow into the valley
 * axis regardless of synoptic direction; a station on a hillside
 * accelerates downslope flow.
 *
 * This file is the single source of truth for these biases. Detectors
 * consult it to:
 *   - DEMOTE confidence when an observation falls inside a sector the
 *     station is known to misread.
 *   - PREFER another reference when the spot's primary station is in
 *     a blind sector for the current pattern.
 *
 * ─── How biases get documented ─────────────────────────────────
 *
 * 1. Empirical evidence (preferred): SQL audit comparing the station
 *    against a nearby buoy or another reliable station. If the ratio of
 *    speeds (station / buoy) diverges materially from 1.0 in some
 *    direction, that's a sheltering or channeling artifact.
 *
 * 2. Documented in CLAUDE.md gotchas: known issues from session work.
 *
 * 3. Geographic reasoning: a station's orography (mountains, valleys)
 *    inferred from its lat/lon and topographic context.
 *
 * Each entry MUST cite WHICH category of evidence supports it. We
 * never invent biases without basis — that just adds noise.
 *
 * Monthly review process: re-run the buoy-vs-station SQL audit (in
 * memory/monthly-station-bias-audit.md) and update sectors here.
 */

export interface StationBias {
  /** Station ID with its source prefix, e.g. 'mg_10018', 'mc_ESGAL...' */
  stationId: string;

  /**
   * Sectors of compass direction where the station's reading is
   * unreliable. Inclusive bounds in degrees, can wrap around (320..40).
   */
  unreliableSectors: Array<{
    /** Inclusive lower bound, 0-359° */
    from: number;
    /** Inclusive upper bound, 0-359° (can be < from for wrap-around) */
    to: number;
    /**
     * What the station does in this sector:
     *   sheltered : reads less than reality (mountain in the way)
     *   channeled : forces all flow into the valley axis
     *   accelerated : downslope effect, reads more than reality
     */
    type: 'sheltered' | 'channeled' | 'accelerated';
  }>;

  /** Short note explaining the orographic reason. */
  note: string;

  /** Source of evidence — how we know this. */
  evidence: 'empirical-buoy' | 'empirical-neighbor' | 'documented-gotcha' | 'geographic';
}

/**
 * Known biases for stations in active use by the app.
 *
 * Empty stations (those not listed) are ASSUMED reliable until proven
 * otherwise. We don't pre-populate every station with placeholder
 * biases — that becomes noise. Each entry is a deliberate, evidenced
 * call.
 */
export const STATION_BIASES: Readonly<Record<string, StationBias>> = {
  // ── Ría de Vigo ──────────────────────────────────────

  'mc_ESGAL3600000036940A': {
    stationId: 'mc_ESGAL3600000036940A',
    unreliableSectors: [
      // Re-audit S135+2 with fresh ground truth (3221 Vigo REDMAR, same
      // ría — 12000+ paired hours):
      //   N (0-30°):   ratio 0.37-0.38 → severely sheltered (Monte to NW)
      //   E-SE (60-150°): ratio 0.43-0.56 → moderate shelter
      //   S (180°):    ratio 0.62 → borderline OK (NOT in blind list)
      //   SW-W (210-300°): ratio 0.57-0.71 → cleanest direction
      //   NW (330°):   ratio 0.60 → borderline OK (NOT in blind list)
      //
      // Initial v2.79.4 entry said 60-180° + wrap-around 300-30°. The
      // fresh audit (vs same-ría buoy, more samples) shows S (180°) and
      // NW (300-330°) are NOT actually as sheltered as the cross-ría
      // 3223 audit suggested. Narrowing to the truly bad sectors:
      { from: 0, to: 150, type: 'sheltered' },  // N + NE + E + SE
    ],
    note: 'Cangas — Monte Costa da Vela apantalla N/NE/E/SE (ratio 0.37-0.56 vs 3221 Vigo REDMAR, mismo ría). S (180°) y SW/W (210-300°) razonables (0.57-0.71). Re-audit S135+2 fresh con boya viva refinó el patrón inicial.',
    evidence: 'empirical-buoy',
  },

  'mg_10018': {
    stationId: 'mg_10018',
    unreliableSectors: [
      // Cesantes sits in the Redondela valley axis (NE-SW). Synoptic
      // flow from any other angle gets channeled into the valley axis,
      // so the station essentially reads NE or SW regardless of the
      // real ría wind. Documented in cesantesCanalizationDetector.ts.
      // No empirical buoy ratio available (Cesantes wind data didn't
      // overlap buoy active hours during the S135+2 audit window).
      { from: 90, to: 200, type: 'channeled' },
      { from: 270, to: 360, type: 'channeled' },
    ],
    note: 'Cesantes — valle Redondela canaliza todo flujo a eje NE-SW. Otras direcciones leen artefactos. Pendiente validación empírica próximo audit (boya Marín no se solapó suficiente con esta estación).',
    evidence: 'documented-gotcha',
  },

  'mg_10049': {
    stationId: 'mg_10049',
    unreliableSectors: [
      // Corrubedo MG is sheltered behind dunes / coastal relief for
      // the open ocean sector. Documented gotcha: reads 5kt when the
      // ría is at 20kt. Only valid for Corrubedo SURF spot itself
      // (0.4km away) — never used as proxy for other spots.
      // No empirical buoy data available (Corrubedo too far from
      // Marín REDMAR / Cabo Silleiro for direct comparison).
      { from: 220, to: 320, type: 'sheltered' },
    ],
    note: 'Corrubedo MG — apantallada por dunas/relieve costero para sector W/SW. Solo válida para spot Corrubedo Surf local.',
    evidence: 'documented-gotcha',
  },

  'mg_10064': {
    stationId: 'mg_10064',
    unreliableSectors: [
      // Empirical buoy audit (S135+2, 7000+ paired hours):
      //   ALL directions: ratio 0.13-0.39 vs both buoys.
      //   This station is GLOBALLY unreliable for "real ría wind",
      //   not directionally biased. Original gotcha said it was
      //   "accelerated for N/NE downslope" — empirically wrong:
      //   it underreads in every sector tested.
      //
      // Practical implication: the detector should NOT use Lourizán
      // as a primary reference for any spot. CLAUDE.md gotcha is
      // updated.
      { from: 0, to: 360, type: 'sheltered' },  // entire compass
    ],
    note: 'Lourizán — globalmente subvalora viento ría (ratio 0.13-0.39 todas direcciones, audit S135+2). Probablemente apantallada por edificios/topografía local. NO usar como referencia primaria de viento ría — preferir mg_14005 Porto de Marín.',
    evidence: 'empirical-buoy',
  },

  'mg_14001': {
    stationId: 'mg_14001',
    unreliableSectors: [
      // Re-audit S135+2 with 3221 Vigo REDMAR (same ría, 12000+ hours):
      //   N-NE (0-90°):  ratio 0.82-1.21 → matches buoy + slight venturi
      //   E-SE (120-150°): ratio 0.46-0.49 → BLIND (city skyline blocks)
      //   S (180°):      ratio 0.96 → matches
      //   SW-W (210-300°): ratio 0.92-1.03 → matches
      //   NW (330°):     ratio 1.26 → venturi acceleration
      //
      // Initial v2.79.4 said 90-180° blind. Fresh audit narrows the
      // truly-bad band to just 120-150° (E-SE). 90° (E pure) and 180°
      // (S) are actually reliable.
      { from: 120, to: 150, type: 'sheltered' },
    ],
    note: 'Porto de Vigo — gold standard. Único sector apantallado: E-SE 120-150° (ratio 0.46-0.49) por skyline portuario. Resto de sectores confiables (0.82-1.21 vs 3221 Vigo REDMAR). Re-audit S135+2 narrowed the band.',
    evidence: 'empirical-buoy',
  },

  'mg_14005': {
    stationId: 'mg_14005',
    unreliableSectors: [
      // Empirical buoy audit (S135+2):
      //   N/NE (0-60°): ratio 0.67-0.81 (decent, slightly under)
      //   E (90°): ratio 0.31 (sheltered single sector — anomaly)
      //   S (180°): ratio 0.97 (matches buoy)
      //   W (240-300°): ratio 0.43-0.58 → afternoon viración
      //                  underread by ~50%! When detector reports
      //                  "6 kt" via this station, real ría wind is
      //                  closer to 11 kt.
      //
      // Implication: the detector's confidence ladder for Lourido /
      // Castiñeiras spots should pull buoy data when available. The
      // viración pattern threshold (expectedAfternoonKt: 7) was set
      // assuming the station value WAS the truth — it's actually
      // half-truth. Future v2.79.X may apply a correction factor
      // 1.7-1.8× for this station's W sector.
      { from: 240, to: 300, type: 'sheltered' },
      { from: 90, to: 90, type: 'sheltered' },  // anomalous single sector
    ],
    note: 'Porto de Marín — sector W/WNW (240-300°) subvalora ~50% (ratio 0.43-0.58 vs Marín REDMAR). Afternoon viración leída como "6 kt" puede ser ~11 kt real en agua abierta. Audit S135+2.',
    evidence: 'empirical-buoy',
  },
};

// ─── Helpers ─────────────────────────────────────────────

/** Inclusive degree-in-range with wrap-around support. */
export function dirInSector(deg: number, sector: { from: number; to: number }): boolean {
  const d = ((deg % 360) + 360) % 360;
  if (sector.from <= sector.to) {
    return d >= sector.from && d <= sector.to;
  }
  return d >= sector.from || d <= sector.to;
}

/**
 * Returns true if the station has a documented bias in this direction.
 */
export function isStationBlindAt(stationId: string, dirDeg: number): boolean {
  const bias = STATION_BIASES[stationId];
  if (!bias) return false;
  return bias.unreliableSectors.some((s) => dirInSector(dirDeg, s));
}

/**
 * Returns the bias entry plus the matched sector, or null when the
 * station has no documented bias in that direction.
 */
export function getStationBiasAt(
  stationId: string,
  dirDeg: number,
): { bias: StationBias; sector: StationBias['unreliableSectors'][number] } | null {
  const bias = STATION_BIASES[stationId];
  if (!bias) return null;
  for (const sector of bias.unreliableSectors) {
    if (dirInSector(dirDeg, sector)) {
      return { bias, sector };
    }
  }
  return null;
}
