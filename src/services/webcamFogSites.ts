/**
 * Camera fog evidence counted by SITE, not by camera.
 *
 * Two cameras on the same mast (Cíes lighthouse, Ons) share the humidity on the glass, the low
 * sun and the hour, so they are not two independent readings: together they count once. When
 * they disagree, the one that sees fog does not count and the site stands as clear. 11-oct 12:44:
 * Ons Praia read fog through a misted glass while Ons Porto, on the same mast, saw none; on 30-sep
 * the same Ons Praia glass turned «probable» into PELIGRO with eleven cameras clear.
 *
 * Known blind spot: from one mast, a camera looking into the ría can see a fog bank that the one
 * looking at the open sea cannot. No such case is on record yet; if one turns up, this is the
 * rule to revisit (with the cameras' azimuths), not a threshold to loosen.
 */

import { haversineDistance } from './geoUtils';

/**
 * The cameras that can speak for a sector: its own (or shared) cameras within `maxKm` of its centre.
 * The camera feed carries every camera in Galicia; until 12-oct a fog at Cies counted in the Embalse,
 * one at A Coruna in the Rias, and the Ribadavia road camera (valley fog, 44 km inland) would have too.
 */
export function camerasForSector<T extends { id: string; lat: number; lon: number; sector: string }>(
  cameras: readonly T[],
  sectorId: string,
  centerLat: number,
  centerLon: number,
  maxKm: number,
): Map<string, { lat: number; lon: number }> {
  const out = new Map<string, { lat: number; lon: number }>();
  for (const w of cameras) {
    if (w.sector !== sectorId && w.sector !== 'all') continue;
    if (haversineDistance(centerLat, centerLon, w.lat, w.lon) > maxKm) continue;
    out.set(w.id, { lat: w.lat, lon: w.lon });
  }
  return out;
}

export interface CameraFogRead {
  id: string;
  /** The camera counts as fog evidence (the caller decides how: the model's flag, the indirect rule). */
  fog: boolean;
  /** The horizon is gone (visibility 'poor'). Only read when `fog` is true. */
  critical?: boolean;
}

export type SiteFogState = 'fog' | 'clear' | 'mixed';

export interface SiteFogSummary {
  /** One entry per site with at least one camera in the input. */
  sites: Map<string, SiteFogState>;
  /** Sites where some camera saw fog and none saw it clear. */
  fogSites: number;
  /** Fog sites where a camera lost the horizon (a subset of fogSites). */
  criticalSites: number;
  /** Sites where the cameras saw no fog, mixed ones included: their clear camera stands. */
  clearSites: number;
  /** One camera per fog site, in input order: for the detail text and the map. */
  fogCameraIds: string[];
  /** Sites whose cameras disagreed. */
  mixedSites: string[];
}

export function summarizeFogBySite(
  reads: readonly CameraFogRead[],
  siteOf: (cameraId: string) => string,
): SiteFogSummary {
  const bySite = new Map<string, { fog: string[]; clear: number; critical: boolean }>();
  for (const r of reads) {
    const site = siteOf(r.id);
    let g = bySite.get(site);
    if (!g) {
      g = { fog: [], clear: 0, critical: false };
      bySite.set(site, g);
    }
    if (r.fog) {
      g.fog.push(r.id);
      if (r.critical) g.critical = true;
    } else {
      g.clear++;
    }
  }

  const sites = new Map<string, SiteFogState>();
  const fogCameraIds: string[] = [];
  const mixedSites: string[] = [];
  let fogSites = 0;
  let criticalSites = 0;
  let clearSites = 0;
  for (const [site, g] of bySite) {
    if (g.fog.length > 0 && g.clear === 0) {
      sites.set(site, 'fog');
      fogSites++;
      if (g.critical) criticalSites++;
      fogCameraIds.push(g.fog[0]);
    } else if (g.fog.length > 0) {
      sites.set(site, 'mixed');
      mixedSites.push(site);
      clearSites++;
    } else {
      sites.set(site, 'clear');
      clearSites++;
    }
  }
  return { sites, fogSites, criticalSites, clearSites, fogCameraIds, mixedSites };
}
