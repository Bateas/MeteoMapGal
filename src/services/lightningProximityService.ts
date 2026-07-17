/**
 * Lightning proximity per spot — LOCAL safety assessment.
 *
 * Answers the question that a sector-wide probability cannot: "is there
 * lightning near MY spot, and is it getting closer?". Input is observed
 * cloud-to-ground strikes (MeteoGalicia meteo2api — certified source, so a
 * confirmed strike can raise an alert on its own), not a model.
 *
 * Pure module: shared by the ingestor analyzer (Telegram alerts) and, later,
 * the frontend map UI. No stores, no fetches.
 *
 * Level rules (rigor: corroboration before shouting):
 *   peligro — >=2 strikes within 10km, or 1 within 10km backed by an active
 *             storm context (>=3 strikes within 25km). A lone strike with no
 *             storm around it never fires the top level.
 *   aviso   — >=3 strikes within 25km: storm active next door.
 * Anything further/quieter stays silent — a strike 40km away is not a
 * decision (measured: the sector-wide ">=1 strike in 40km" floor sits at a
 * 21% climatological base rate, useless as a personal signal).
 */

import { haversineDistance } from './geoUtils';

export interface ProximityStrike {
  lat: number;
  lon: number;
  time: Date;
}

export interface ProximitySpot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  sector?: string;
}

export type LightningRiskLevel = 'peligro' | 'aviso';

export interface SpotLightningRisk {
  spotId: string;
  spotName: string;
  sector?: string;
  level: LightningRiskLevel;
  /** Distance to the closest fresh strike (km) */
  nearestKm: number;
  /** Strikes within LIGHTNING_DANGER_KM in the window */
  countNear: number;
  /** Strikes within LIGHTNING_WARN_KM in the window */
  count25: number;
  /** Mean strike distance is shrinking between the two half-windows */
  approaching: boolean;
  /** Rough minutes until the activity reaches the spot; null when not
   *  approaching, already on top (<3km), or outside 5-90min plausibility */
  etaMin: number | null;
  /** Age of the freshest strike within LIGHTNING_WARN_KM (minutes) */
  freshestAgeMin: number;
}

export const LIGHTNING_DANGER_KM = 10;
export const LIGHTNING_WARN_KM = 25;
/** Strikes inside this radius feed the approach-trend estimate */
const TREND_KM = 60;
/** meteo2api publishes with 3-5min lag; 20min covers the live storm state */
export const LIGHTNING_WINDOW_MIN = 20;
const HALF_WINDOW_MIN = 10;
/** Mean distance must shrink at least this much between half-windows */
const APPROACH_MIN_DELTA_KM = 2;

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Assess local lightning risk for each spot. Returns ONLY spots that reach
 * a level, worst first (peligro before aviso, then closest first).
 *
 * Strikes are expected pre-filtered to cloud-to-ground; stale ones (older
 * than the window) are dropped here defensively.
 */
export function assessSpotLightningRisk(
  spots: ProximitySpot[],
  strikes: ProximityStrike[],
  now: Date = new Date(),
): SpotLightningRisk[] {
  if (spots.length === 0 || strikes.length === 0) return [];

  // Age in minutes, clock-skew tolerant (a strike stamped seconds ahead of
  // our clock counts as age 0, not negative)
  const fresh = strikes
    .map((s) => ({ s, ageMin: Math.max(0, (now.getTime() - s.time.getTime()) / 60_000) }))
    .filter((e) => (now.getTime() - e.s.time.getTime()) / 60_000 <= LIGHTNING_WINDOW_MIN);
  if (fresh.length === 0) return [];

  const risks: SpotLightningRisk[] = [];

  for (const spot of spots) {
    const withDist = fresh.map((e) => ({
      ...e,
      distKm: haversineDistance(spot.lat, spot.lon, e.s.lat, e.s.lon),
    }));

    const within25 = withDist.filter((e) => e.distKm <= LIGHTNING_WARN_KM);
    if (within25.length === 0) continue;

    const countNear = within25.filter((e) => e.distKm <= LIGHTNING_DANGER_KM).length;
    const count25 = within25.length;

    let level: LightningRiskLevel | null = null;
    if (countNear >= 2 || (countNear >= 1 && count25 >= 3)) level = 'peligro';
    else if (count25 >= 3) level = 'aviso';
    if (!level) continue;

    const nearestKm = Math.min(...within25.map((e) => e.distKm));
    const freshestAgeMin = Math.min(...within25.map((e) => e.ageMin));

    // Approach trend: compare mean distance of the recent half-window vs the
    // older one, over a wider radius so we see the storm coming before it is
    // already inside the alert bands. Needs >=2 strikes per half-window —
    // small samples make centroids jump (documented cluster instability).
    const trend = withDist.filter((e) => e.distKm <= TREND_KM);
    const recent = trend.filter((e) => e.ageMin <= HALF_WINDOW_MIN);
    const older = trend.filter((e) => e.ageMin > HALF_WINDOW_MIN);
    let approaching = false;
    let etaMin: number | null = null;
    if (recent.length >= 2 && older.length >= 2) {
      const meanRecent = mean(recent.map((e) => e.distKm));
      const meanOlder = mean(older.map((e) => e.distKm));
      const deltaKm = meanOlder - meanRecent;
      if (deltaKm >= APPROACH_MIN_DELTA_KM) {
        approaching = true;
        const speedKmPerMin = deltaKm / HALF_WINDOW_MIN;
        if (nearestKm >= 3 && speedKmPerMin > 0) {
          const rawEta = nearestKm / speedKmPerMin;
          if (rawEta >= 5 && rawEta <= 90) {
            etaMin = Math.round(rawEta / 5) * 5;
          }
        }
      }
    }

    risks.push({
      spotId: spot.id,
      spotName: spot.name,
      sector: spot.sector,
      level,
      nearestKm: Math.round(nearestKm * 10) / 10,
      countNear,
      count25,
      approaching,
      etaMin,
      freshestAgeMin: Math.round(freshestAgeMin),
    });
  }

  risks.sort((a, b) => {
    if (a.level !== b.level) return a.level === 'peligro' ? -1 : 1;
    return a.nearestKm - b.nearestKm;
  });
  return risks;
}

/** One human line per spot for alerts/UI: "Cesantes: rayo a 6km (5 en 20min, acercandose ~15min)" */
export function formatRiskLine(r: SpotLightningRisk): string {
  const kmTxt = r.nearestKm < 1 ? '<1km' : `${Math.round(r.nearestKm)}km`;
  let extra = `${r.count25} en ${LIGHTNING_WINDOW_MIN}min`;
  if (r.approaching) {
    extra += r.etaMin != null ? `, acercandose ~${r.etaMin}min` : ', acercandose';
  }
  return `${r.spotName}: rayo a ${kmTxt} (${extra})`;
}
