/**
 * User-suggested spots ("chincheta").
 *
 * A user can drop a pin anywhere on the map to get a BASIC, UNCALIBRATED
 * estimate scored by the same config-driven engine (`scoreAllSpots`) using the
 * stations/buoys that happen to fall within the pin's radius. They can also
 * report it through the anonymous feedback pipeline so it can be curated into
 * an official spot later.
 *
 * MOAT (O3 — confianza del dato): user spots are intentionally kept SEPARATE
 * from the official `spots.ts` list. They NEVER feed the official scoring
 * store, the Telegram alerts, the daily summary, or the ingestor. They live
 * only in the user's browser (localStorage) and always carry a "SIN CALIBRAR"
 * badge — because the lección Liméns proved the radius consensus can be wrong
 * in a microclimate, and only a curated reference station fixes that.
 *
 * This module is PURE (no React, no store) so it is fully unit-testable.
 */

import type { SailingSpot } from './spots';
import { sanitize } from '../services/feedbackSanitize';

/** A user-created pin. Only the location is persisted — the verdict is always
 *  recomputed live, never stored (it would go stale and the user must see that
 *  it reflects current conditions, not a snapshot). */
export interface UserSpot {
  /** Stable id, generated at creation time (`user-<base36 ts>`). */
  id: string;
  /** Short display name. Sanitized + length-capped. */
  name: string;
  /** [lon, lat] */
  center: [number, number];
  /** Sector this pin belongs to ('rias' | 'embalse'). Set from the active sector. */
  sectorId: string;
  /** Creation timestamp (ms). */
  createdAt: number;
}

/** Hard cap on stored pins — guards localStorage growth + map clutter. */
export const MAX_USER_SPOTS = 12;

/** Default scoring radius for a pin (km). Generous so it picks up nearby
 *  stations/buoys, matching the official spots' typical 6-12 km. */
export const USER_SPOT_RADIUS_KM = 8;

/** Max characters for a user spot name. */
export const MAX_NAME_CHARS = 40;

/** Generous Galicia bounding box [lon, lat]. Pins outside are rejected — a
 *  basic estimate over the open Atlantic or another region is meaningless and
 *  would only confuse. */
export const GALICIA_BBOX = {
  minLon: -9.6,
  maxLon: -6.7,
  minLat: 41.7,
  maxLat: 44.0,
} as const;

/** True when [lon, lat] is finite and inside the Galicia bbox. */
export function isInGalicia(lon: number, lat: number): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= GALICIA_BBOX.minLon &&
    lon <= GALICIA_BBOX.maxLon &&
    lat >= GALICIA_BBOX.minLat &&
    lat <= GALICIA_BBOX.maxLat
  );
}

/** Sanitize + cap a user-provided spot name. Reuses the feedback sanitizer
 *  (strips HTML/JS/SQL/control chars) for defense-in-depth, even though it is
 *  only ever rendered inside React (which escapes) and persisted locally. */
export function sanitizeSpotName(raw: string): string {
  return sanitize(raw).slice(0, MAX_NAME_CHARS).trim();
}

/** Deterministic id from a timestamp — pure for testability. The store adds a
 *  collision suffix in the rare case two pins share the same millisecond. */
export function makeUserSpotId(now: number): string {
  return `user-${Math.floor(now).toString(36)}`;
}

/** Default name based on how many pins already exist. */
export function defaultUserSpotName(existingCount: number): string {
  return `Mi spot ${existingCount + 1}`;
}

// ── Suggestion report ─────────────────────────────────────────

/** Data snapshot bundled into the "suggest validation" report so the spot can
 *  be curated with real context. All fields optional — missing ones are
 *  omitted. ASCII-only output (no °/·/~) so it matches what the user sees and
 *  survives the feedback sanitizer untouched. */
export interface SuggestionData {
  name: string;
  lat: number;
  lon: number;
  windKt?: number | null;
  windDir?: string | null;
  windSources?: number;
  waveHeightM?: number | null;
  waterTempC?: number | null;
  /** Next tide (high/low) — conveys whether it is rising or falling now. */
  tide?: { type: 'high' | 'low'; time: string; heightM: number } | null;
  /** WRF-MG forecast for the next few hours. */
  wrf?: { kt: number; dir: string } | null;
}

/** Build the pre-filled "suggest validation" report text (multi-line, concise,
 *  ASCII-safe). Always leads with name + coords; appends whatever data exists. */
export function buildSpotSuggestion(d: SuggestionData): string {
  const lines: string[] = [];
  lines.push(`Sugiero validar este spot: ${d.name}`);
  lines.push(`Coordenadas: ${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}`);

  if (d.windKt != null) {
    const dir = d.windDir ? ` ${d.windDir}` : '';
    const src = d.windSources ? ` (${d.windSources} fuentes)` : '';
    lines.push(`Viento ahora: ${Math.round(d.windKt)}kt${dir}${src}`);
  }
  if (d.waveHeightM != null) {
    lines.push(`Olas: ${d.waveHeightM.toFixed(1)}m`);
  }
  if (d.waterTempC != null) {
    lines.push(`Agua: ${Math.round(d.waterTempC)}C`);
  }
  if (d.tide) {
    const trend = d.tide.type === 'high' ? 'subiendo' : 'bajando';
    const label = d.tide.type === 'high' ? 'pleamar' : 'bajamar';
    lines.push(`Marea: ${trend} (${label} ${d.tide.time}, ${d.tide.heightM.toFixed(1)}m)`);
  }
  if (d.wrf) {
    lines.push(`WRF prox horas: ${Math.round(d.wrf.kt)}kt ${d.wrf.dir}`);
  }
  return lines.join('\n');
}

/**
 * Convert a UserSpot into a `SailingSpot` the engine can score.
 *
 * Deliberately minimal: no preferred stations, no wind patterns, no thermal /
 * bocana detection, no calibration. This forces the engine down its GENERIC
 * path — verdict driven purely by the nearby wind consensus — which is exactly
 * the honest "basic estimate" we want. The id is cast to `SpotId`; the engine
 * only string-compares ids against known literals (cesantes/cies-ria/…), so an
 * unknown `user-*` id simply never matches a special case.
 */
export function userSpotToSailingSpot(us: UserSpot): SailingSpot {
  return {
    id: us.id as SailingSpot['id'],
    name: us.name,
    shortName: us.name,
    icon: 'map-pin',
    center: us.center,
    radiusKm: USER_SPOT_RADIUS_KM,
    description: '',
    windPatterns: [],
    preferredStations: [],
    preferredBuoys: [],
    waveRelevance: 'none',
    thermalDetection: false,
    hardGates: {},
    beta: true,
  };
}
