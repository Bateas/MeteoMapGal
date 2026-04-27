/**
 * Pure helpers for active-fire processing.
 *
 * - Parse FIRMS CSV → ActiveFire[]
 * - Filter low-confidence + industrial false-positives
 * - Classify aggregate severity for sector
 *
 * No I/O — fetched separately by firmsClient + ingestor proxy.
 */

import type { ActiveFire, FireConfidence } from '../types/fire';

/** VIIRS confidence letter → enum */
function parseConfidence(letter: string): FireConfidence {
  const c = letter?.trim().toLowerCase();
  if (c === 'h') return 'high';
  if (c === 'n') return 'nominal';
  return 'low';
}

/**
 * Parse FIRMS Area-API CSV response into ActiveFire[].
 * Column order documented in https://firms.modaps.eosdis.nasa.gov/api/area/
 *
 * latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,
 * instrument,confidence,version,bright_ti5,frp,daynight
 */
export function parseFirmsCsv(csv: string): ActiveFire[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const out: ActiveFire[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 14) continue;

    const lat = Number.parseFloat(cols[0]);
    const lon = Number.parseFloat(cols[1]);
    const brightness = Number.parseFloat(cols[2]);
    const acqDate = cols[5];
    const acqTime = cols[6]; // HHMM string, e.g. "1242" or "258" (no leading zero)
    const satellite = cols[7];
    const confidence = parseConfidence(cols[9]);
    const frp = Number.parseFloat(cols[12]);
    const daynight = cols[13]?.trim() === 'D' ? 'D' : 'N';

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    // FIRMS time is HHMM UTC, stripped of leading zeros (e.g. "258" → 02:58)
    const tStr = acqTime.padStart(4, '0');
    const hour = Number(tStr.slice(0, 2));
    const min = Number(tStr.slice(2, 4));
    const acquiredAt = new Date(`${acqDate}T${tStr.slice(0, 2)}:${tStr.slice(2, 4)}:00Z`);
    if (Number.isNaN(acquiredAt.getTime())) continue;
    if (!Number.isFinite(hour) || !Number.isFinite(min)) continue;

    out.push({
      id: `${lat.toFixed(5)}_${lon.toFixed(5)}_${acqDate}_${tStr}`,
      lat,
      lon,
      brightness: Number.isFinite(brightness) ? brightness : 0,
      frp: Number.isFinite(frp) ? frp : 0,
      acquiredAt,
      satellite,
      confidence,
      daynight,
    });
  }
  return out;
}

/**
 * Filter out low-confidence and likely-industrial hotspots.
 * VIIRS picks up gas flares, steel mills, etc. — those usually have:
 * - confidence='low' (algorithm itself is unsure), OR
 * - very low brightness (<320K) (industrial heat signatures are colder than wildfires)
 */
export function filterRealFires(fires: ActiveFire[]): ActiveFire[] {
  return fires.filter(
    (f) => f.confidence !== 'low' && f.brightness >= 320,
  );
}

export type FireSeverity = 'none' | 'info' | 'aviso' | 'alerta';

export interface FireAggregate {
  severity: FireSeverity;
  /** Count after low-confidence filter */
  total: number;
  /** Highest FRP across all fires (MW) */
  maxFrp: number;
  /** True if any fire is within `criticalKm` of `[lon, lat]` */
  nearSector: boolean;
  /** Distance (km) from sector center to nearest fire, null if no fires */
  nearestKm: number | null;
}

/**
 * Aggregate fires for a sector — used to classify dashboard alert severity.
 * Distance check uses simple equirectangular approx (good enough at <500km).
 */
export function aggregateFiresForSector(
  fires: ActiveFire[],
  sectorCenter: [number, number], // [lon, lat]
  warnKm = 50,
  criticalKm = 25,
): FireAggregate {
  if (fires.length === 0) {
    return { severity: 'none', total: 0, maxFrp: 0, nearSector: false, nearestKm: null };
  }

  const [cLon, cLat] = sectorCenter;
  let maxFrp = 0;
  let nearestKm: number | null = null;

  for (const f of fires) {
    if (f.frp > maxFrp) maxFrp = f.frp;
    // Equirectangular approximation — ~1° lat = 111km
    const dLat = (f.lat - cLat) * 111;
    const dLon = (f.lon - cLon) * 111 * Math.cos((cLat * Math.PI) / 180);
    const dKm = Math.hypot(dLat, dLon);
    if (nearestKm === null || dKm < nearestKm) nearestKm = dKm;
  }

  const nearSector = nearestKm !== null && nearestKm <= warnKm;
  let severity: FireSeverity = 'info';
  if (nearestKm !== null && nearestKm <= criticalKm) severity = 'alerta';
  else if (nearSector) severity = 'aviso';

  // Big fires anywhere in bbox bump severity by one notch (regional smoke risk)
  if (maxFrp >= 100 && severity === 'info') severity = 'aviso';

  return { severity, total: fires.length, maxFrp, nearSector, nearestKm };
}
