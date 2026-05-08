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
      // Cangas is on the N coast of Ría de Vigo at the foot of Monte
      // Costa da Vela. Winds from S/SW (i.e. from over the ría from
      // the Vigo side) hit the mountain before the anemometer →
      // significant shelter. Audit S135+2 shows afternoon viración
      // at 5-6 kt vs Vigo port's 8-9 kt for same hours.
      { from: 180, to: 240, type: 'sheltered' },
    ],
    note: 'Cangas — Monte Costa da Vela apantalla viento del S/SW. Audit S135+2: lee ~60% del viento de Porto de Vigo en mismas horas.',
    evidence: 'empirical-neighbor',
  },

  'mg_10018': {
    stationId: 'mg_10018',
    unreliableSectors: [
      // Cesantes sits in the Redondela valley axis (NE-SW). Synoptic
      // flow from any other angle gets channeled into the valley axis,
      // so the station essentially reads NE or SW regardless of the
      // real ría wind. Documented in cesantesCanalizationDetector.ts.
      { from: 90, to: 200, type: 'channeled' },
      { from: 270, to: 360, type: 'channeled' },
    ],
    note: 'Cesantes — valle Redondela canaliza todo flujo a eje NE-SW. Otras direcciones leen artefactos.',
    evidence: 'documented-gotcha',
  },

  'mg_10049': {
    stationId: 'mg_10049',
    unreliableSectors: [
      // Corrubedo MG is sheltered behind dunes / coastal relief for
      // the open ocean sector. Documented gotcha: reads 5kt when the
      // ría is at 20kt. Only valid for Corrubedo SURF spot itself
      // (0.4km away) — never used as proxy for other spots.
      { from: 220, to: 320, type: 'sheltered' },
    ],
    note: 'Corrubedo MG — apantallada por dunas/relieve costero para sector W/SW. Solo válida para spot Corrubedo Surf local.',
    evidence: 'documented-gotcha',
  },

  'mg_10064': {
    stationId: 'mg_10064',
    unreliableSectors: [
      // Lourizán is at 52m altitude on the south slope of the Ría de
      // Pontevedra. Downslope acceleration from N-NE flow makes
      // morning terral readings overestimate. CLAUDE.md gotcha:
      // "Lourizán (52m, 1.8km) — land station, less representative
      // than water buoys".
      { from: 0, to: 60, type: 'accelerated' },
    ],
    note: 'Lourizán (52m altitud) — falda S de Ría Pontevedra acelera viento N/NE downslope.',
    evidence: 'documented-gotcha',
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
