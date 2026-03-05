/**
 * Airspace evaluation service — checks drone flight restrictions.
 *
 * Evaluates whether a geographic point (sector center) falls within
 * ENAIRE UAS restricted zones or has active NOTAMs. Combines with
 * altitude checks to produce an AirspaceCheck verdict.
 */

import type { UasZone, ActiveNotam } from '../api/enaireClient';
import { fastDistanceKm } from './idwInterpolation';

// ── Types ──────────────────────────────────────────────────

export type AirspaceSeverity = 'none' | 'caution' | 'prohibited';

export interface AirspaceRestriction {
  name: string;
  type: string;
  maxAltitudeM: number;
  reason: string;
  contact?: string;
}

export interface NotamSummary {
  id: string;
  description: string;
  severity: 'info' | 'caution' | 'prohibited';
  validUntil: Date;
  /** ICAO location code (e.g. LEVX) */
  location: string;
  /** Lower altitude in ft AGL */
  lowerAltFt: number;
  /** Upper altitude in ft */
  upperAltFt: number;
  /** Valid from */
  validFrom: Date;
}

export interface AirspaceCheck {
  /** Any restriction affecting this point? */
  restricted: boolean;
  /** Worst-case severity across all zones + NOTAMs */
  severity: AirspaceSeverity;
  /** UAS zones affecting the point */
  zones: AirspaceRestriction[];
  /** Active NOTAMs in the area */
  notams: NotamSummary[];
}

// ── Default flight altitude (EU UAS regulation: max 120m AGL) ──

const DEFAULT_FLIGHT_ALT_M = 120;

// ── Point-in-polygon (ray-casting) ─────────────────────────
// Simple algorithm — works for convex/concave polygons without holes.
// Sufficient for ENAIRE UAS zones which are simple polygons.

function pointInPolygon(
  lat: number,
  lon: number,
  ring: number[][],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]; // [lon, lat] in GeoJSON
    const xj = ring[j][0], yj = ring[j][1];

    const intersect =
      (yi > lat) !== (yj > lat) &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}

/** Check if point [lon, lat] is inside any ring of a GeoJSON Polygon */
function pointInGeoJSONPolygon(
  lat: number,
  lon: number,
  coordinates: number[][][],
): boolean {
  // Check outer ring (first ring)
  if (!coordinates[0] || !pointInPolygon(lat, lon, coordinates[0])) {
    return false;
  }
  // Check holes (subsequent rings) — inside a hole means outside the polygon
  for (let i = 1; i < coordinates.length; i++) {
    if (pointInPolygon(lat, lon, coordinates[i])) return false;
  }
  return true;
}

// ── HTML sanitization ──────────────────────────────────────
// ENAIRE `message` fields contain HTML tags (<br>, <b>, etc.)

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Zone type → severity mapping ───────────────────────────

function zoneTypeSeverity(type: string): AirspaceSeverity {
  const upper = type.toUpperCase();
  if (upper.includes('PROHIBITED') || upper.includes('PROHIBID')) return 'prohibited';
  if (upper.includes('REQ_AUTH') || upper.includes('AUTORIZA')) return 'caution';
  if (upper.includes('CONDITIONAL') || upper.includes('CONDICION')) return 'caution';
  return 'caution'; // Default to caution for unknown restriction types
}

// ── NOTAM Q-code → severity ────────────────────────────────

function notamSeverity(qcode: string, description: string): 'info' | 'caution' | 'prohibited' {
  const upper = (qcode + ' ' + description).toUpperCase();
  if (upper.includes('PROHIB') || upper.includes('CLOSED') || upper.includes('CERRAD')) return 'prohibited';
  if (upper.includes('RESTRICT') || upper.includes('SEGREG') || upper.includes('DANGER') || upper.includes('PELIGRO')) return 'caution';
  return 'info';
}

// ── Main evaluation function ───────────────────────────────

/**
 * Evaluate airspace restrictions at a given point.
 *
 * @param center  - [lon, lat] of the sector center
 * @param radiusKm - Sector radius in km (NOTAMs checked within this)
 * @param zones   - UAS zones from ENAIRE
 * @param notams  - Active NOTAMs from ENAIRE
 * @param flightAltitudeM - Planned flight altitude in metres (default 120m)
 */
export function evaluateAirspace(
  center: [number, number],
  radiusKm: number,
  zones: UasZone[],
  notams: ActiveNotam[],
  flightAltitudeM = DEFAULT_FLIGHT_ALT_M,
): AirspaceCheck {
  const [lon, lat] = center;
  const now = Date.now();

  const matchedZones: AirspaceRestriction[] = [];
  const matchedNotams: NotamSummary[] = [];
  let worstSeverity: AirspaceSeverity = 'none';

  // ── Check UAS zones ──
  for (const zone of zones) {
    // Skip zones whose altitude range doesn't overlap our flight altitude
    const zoneFloor = zone.lowerAltitude;
    const zoneCeiling = zone.upperAltitude;
    if (flightAltitudeM < zoneFloor) continue; // Flying below restricted zone
    // Note: if ceiling is 0 or unreasonable, assume it covers all altitudes
    if (zoneCeiling > 0 && flightAltitudeM > zoneCeiling) continue;

    // Point-in-polygon check
    let inside = false;
    if (zone.geometry.type === 'Polygon') {
      inside = pointInGeoJSONPolygon(lat, lon, zone.geometry.coordinates);
    } else if (zone.geometry.type === 'MultiPolygon') {
      for (const poly of zone.geometry.coordinates) {
        if (pointInGeoJSONPolygon(lat, lon, poly)) {
          inside = true;
          break;
        }
      }
    }

    if (!inside) continue;

    const severity = zoneTypeSeverity(zone.type);
    matchedZones.push({
      name: zone.name,
      type: zone.type,
      maxAltitudeM: zoneCeiling,
      reason: stripHtml(zone.message || zone.reasons || zone.type),
      contact: zone.phone || zone.email || undefined,
    });

    if (severityRank(severity) > severityRank(worstSeverity)) {
      worstSeverity = severity;
    }
  }

  // Deduplicate zones by name+type (same zone can appear in multiple ENAIRE layers)
  const seenZones = new Set<string>();
  const uniqueZones = matchedZones.filter((z) => {
    const key = `${z.name}|${z.type}`;
    if (seenZones.has(key)) return false;
    seenZones.add(key);
    if (!z.name) return false;
    return true;
  });

  // ── Check NOTAMs ──
  const FT_PER_M = 3.28084;
  const flightAltitudeFt = flightAltitudeM * FT_PER_M; // ~394 ft for 120m

  for (const notam of notams) {
    // Skip expired NOTAMs
    if (notam.endDate.getTime() < now) continue;
    // Skip future NOTAMs
    if (notam.startDate.getTime() > now) continue;

    // Skip NOTAMs whose floor is above drone flight altitude (120m AGL)
    // If lowerAltitudeAglFt > 0 and above our ceiling → doesn't affect drones
    if (notam.lowerAltitudeAglFt > 0 && notam.lowerAltitudeAglFt > flightAltitudeFt) continue;

    // Distance check (NOTAMs are relevant within sector radius)
    let inRange = false;
    if (notam.geometry.type === 'Point') {
      const [nLon, nLat] = notam.geometry.coordinates;
      const dist = fastDistanceKm(lat, lon, nLat, nLon);
      inRange = dist <= radiusKm;
    } else if (notam.geometry.type === 'Polygon') {
      // For polygon NOTAMs, check if center is inside
      inRange = pointInGeoJSONPolygon(lat, lon, notam.geometry.coordinates);
    }

    if (!inRange) continue;

    const sev = notamSeverity(notam.qcode, notam.description);
    matchedNotams.push({
      id: notam.notamId,
      description: stripHtml(notam.description),
      severity: sev,
      validUntil: notam.endDate,
      location: notam.location,
      lowerAltFt: notam.lowerAltitudeAglFt || notam.lowerAltitudeFt,
      upperAltFt: notam.upperAltitudeFt,
      validFrom: notam.startDate,
    });

    // Escalate overall severity based on NOTAM
    if (sev === 'prohibited' && severityRank('prohibited') > severityRank(worstSeverity)) {
      worstSeverity = 'prohibited';
    } else if (sev === 'caution' && severityRank('caution') > severityRank(worstSeverity)) {
      worstSeverity = 'caution';
    }
  }

  return {
    restricted: uniqueZones.length > 0 || matchedNotams.some(n => n.severity !== 'info'),
    severity: worstSeverity,
    zones: uniqueZones,
    notams: matchedNotams,
  };
}

// ── Helpers ────────────────────────────────────────────────

function severityRank(s: AirspaceSeverity | 'info'): number {
  switch (s) {
    case 'prohibited': return 3;
    case 'caution': return 2;
    case 'info': return 1;
    case 'none': return 0;
    default: return 0;
  }
}
