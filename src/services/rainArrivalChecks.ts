/**
 * Did the rain we announced arrive? Every «llega a X en ~N min» is written down when first said
 * and checked against the GAUGES near the spot, the observation the radar cannot fake: the radar
 * announces, the rain gauge confirms. A spot with no gauge near (open water) can only be checked
 * by the radar itself, and says so.
 *
 * Kept for the session only (the toolbar legend shows the last ones); it is the first piece of
 * the calibration the ETA still needs in Galicia.
 * Pure: no fetch, no DOM.
 */

import type { GaugeRain } from './rainNowService';

/** A gauge this close to the spot speaks for it. */
export const CHECK_GAUGE_KM = 8;
/** After the announced time, how long the rain still counts as arriving. */
export const CHECK_LATE_MIN = 30;
/** Resolved checks are kept this long, then forgotten. */
const KEEP_RESOLVED_MIN = 180;
const MAX_CHECKS = 12;

export type CheckStatus = 'pending' | 'arrived' | 'arrived-radar' | 'missed';

export interface ArrivalCheck {
  spotId: string;
  spotName: string;
  /** When it was first announced, ms */
  issuedAt: number;
  /** Announced arrival, ms */
  dueAt: number;
  status: CheckStatus;
  /** When the arrival was seen, ms */
  seenAt?: number;
  /** The gauge that measured it */
  gaugeName?: string;
  gaugeMm?: number;
  /** The radar had rain over the spot (kept while waiting for a gauge) */
  radarSeenAt?: number;
}

function distKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dx = (aLon - bLon) * 111.32 * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  return Math.hypot(dx, (aLat - bLat) * 111.32);
}

/**
 * One step of the ledger. `arrivals` are this cycle's (etaMin 0 = raining there now by radar);
 * `gauges` are classifyGauges' verdicts; `spots` give the places.
 */
export function updateArrivalChecks(
  prev: ArrivalCheck[],
  opts: {
    nowMs: number;
    arrivals: { spotId: string; spotName: string; etaMin: number }[];
    gauges: GaugeRain[];
    spots: { id: string; lon: number; lat: number }[];
  },
): ArrivalCheck[] {
  const { nowMs, arrivals, gauges, spots } = opts;
  const where = new Map(spots.map((s) => [s.id, s]));
  const nearGauges = (spotId: string) => {
    const s = where.get(spotId);
    if (!s) return [];
    return gauges
      .filter((g) => g.verdict !== 'blacklist' && distKm(s.lat, s.lon, g.lat, g.lon) <= CHECK_GAUGE_KM)
      .sort((a, b) => distKm(s.lat, s.lon, a.lat, a.lon) - distKm(s.lat, s.lon, b.lat, b.lon));
  };
  const radarNow = new Set(arrivals.filter((a) => a.etaMin === 0).map((a) => a.spotId));

  const next: ArrivalCheck[] = prev
    .filter((c) => c.status === 'pending' || nowMs - (c.seenAt ?? c.dueAt) <= KEEP_RESOLVED_MIN * 60_000)
    .map((c) => {
      if (c.status !== 'pending') return c;
      const near = nearGauges(c.spotId);
      const wet = near.find((g) => g.verdict === 'rain');
      if (wet) return { ...c, status: 'arrived' as const, seenAt: nowMs, gaugeName: wet.name, gaugeMm: wet.mm };
      const radarSeenAt = c.radarSeenAt ?? (radarNow.has(c.spotId) ? nowMs : undefined);
      if (nowMs > c.dueAt + CHECK_LATE_MIN * 60_000) {
        // No gauge near: the radar is the only witness, and it is named as such.
        if (radarSeenAt && near.length === 0) return { ...c, status: 'arrived-radar' as const, seenAt: radarSeenAt, radarSeenAt };
        return { ...c, status: 'missed' as const, radarSeenAt };
      }
      return { ...c, radarSeenAt };
    });

  for (const a of arrivals) {
    if (a.etaMin <= 0) continue;
    if (next.some((c) => c.spotId === a.spotId && c.status === 'pending')) continue;   // the first announcement is the one checked
    if (nearGauges(a.spotId).some((g) => g.verdict === 'rain')) continue;                // already raining there: nothing to check
    next.push({ spotId: a.spotId, spotName: a.spotName, issuedAt: nowMs, dueAt: nowMs + a.etaMin * 60_000, status: 'pending' });
  }
  return next.slice(-MAX_CHECKS);
}
