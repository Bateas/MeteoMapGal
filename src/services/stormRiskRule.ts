/**
 * Forecast storm risk for an hour: instability the model does not cap. One rule for the 9 h
 * Telegram summary (ingestor/dailySummary.ts) and the forecast panel, so the two never disagree.
 *
 * It is a RISK from the model, not a storm: confirmed storms need real lightning (storm-severity
 * rule). Measured 6-oct over 160 days x 2 sectors (31 days with >= 5 strikes inside the sector
 * between 8 and 21 h): CAPE 1000 caught 9 of them at 31 % precision; CAPE 300 catches 21 at 40 %.
 * Galician storms are low-CAPE: 6-oct, 2.400 strikes, peaked at 590.
 */
export const STORM_CAPE = 300;
export const STORM_LI = -2;
export const STORM_CIN_MAX = 200;

export interface InstabilityHour {
  cape?: number | null;
  liftedIndex?: number | null;
  cin?: number | null;
}

export function isStormRiskHour(f: InstabilityHour): boolean {
  return (f.cape ?? 0) >= STORM_CAPE && (f.liftedIndex ?? 99) <= STORM_LI && (f.cin ?? 0) < STORM_CIN_MAX;
}
