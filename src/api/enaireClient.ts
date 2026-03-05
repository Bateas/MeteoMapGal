/**
 * ENAIRE API client — fetches airspace restrictions from Spain's AIS provider.
 *
 * Two services (ArcGIS REST, no authentication, GeoJSON output):
 * 1. Zonas UAS (ZGUAS) — 4 layers: Aero, Infra, Medioambiente, Urbano
 * 2. NOTAMs activos — Active temporary flight restrictions
 *
 * ⚠️ Subdomain difference:
 *   - UAS zones:  servais.enaire.es/insignia/...  (no S)
 *   - NOTAMs:     servais.enaire.es/insignias/... (with S)
 *
 * Cache: zones 24h (semi-static), NOTAMs 30min (dynamic)
 */

// ── Types ──────────────────────────────────────────────────

export interface UasZone {
  name: string;
  type: 'PROHIBITED' | 'REQ_AUTHORIZATION' | 'CONDITIONAL' | string;
  variant: string;
  message: string;
  reasons: string;
  lowerAltitude: number;   // metres
  upperAltitude: number;   // metres
  altitudeReference: string; // AGL, AMSL
  validFrom: string;
  validTo: string;
  phone: string;
  email: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export interface ActiveNotam {
  notamId: string;
  location: string;
  description: string;
  lowerAltitudeFt: number;
  upperAltitudeFt: number;
  lowerAltitudeAglFt: number;
  startDate: Date;
  endDate: Date;
  qcode: string;
  geometry: GeoJSON.Point | GeoJSON.Polygon;
}

// ── ArcGIS REST response shapes ────────────────────────────

interface ArcGISFeature {
  attributes: Record<string, unknown>;
  geometry?: {
    rings?: number[][][];
    x?: number;
    y?: number;
    points?: number[][];
  };
}

interface ArcGISResponse {
  features?: ArcGISFeature[];
  error?: { message: string; code: number };
}

// ── Cache ──────────────────────────────────────────────────

const ZONE_CACHE_TTL = 24 * 60 * 60 * 1000;  // 24h
const NOTAM_CACHE_TTL = 30 * 60 * 1000;       // 30min

let cachedZones: UasZone[] = [];
let zonesCachedAt = 0;

let cachedNotams: ActiveNotam[] = [];
let notamsCachedAt = 0;

// ── Proxy-aware URL builder ────────────────────────────────
// Uses /enaire-api proxy (Vite dev) / nginx (prod) to avoid CORS

const UAS_LAYERS = [0, 1, 2, 3]; // Aero, Infra, Medioambiente, Urbano
const UAS_BASE = '/enaire-api/insignia/rest/services/NSF_SRV/SRV_UAS_ZG_V1/MapServer';
const NOTAM_BASE = '/enaire-api/insignias/rest/services/InfoARES/NOTAM_APP_V3/MapServer';

function buildQueryUrl(base: string, layer: number, bbox: [number, number, number, number]): string {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const params = new URLSearchParams({
    where: '1=1',
    f: 'json',
    outFields: '*',
    geometry: `${minLon},${minLat},${maxLon},${maxLat}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    returnGeometry: 'true',
  });
  return `${base}/${layer}/query?${params}`;
}

// ── Parsers ────────────────────────────────────────────────

function parseUasFeature(f: ArcGISFeature): UasZone | null {
  const a = f.attributes;
  if (!f.geometry?.rings) return null;

  // Convert ArcGIS rings → GeoJSON Polygon coordinates
  const coordinates = f.geometry.rings.map(ring =>
    ring.map(([x, y]) => [x, y] as [number, number])
  );

  return {
    name: String(a['NOMBRE'] ?? a['NAME'] ?? a['name'] ?? 'Sin nombre'),
    type: String(a['RESTRICCION'] ?? a['RESTRICTION'] ?? a['TIPO'] ?? a['type'] ?? 'UNKNOWN'),
    variant: String(a['VARIANTE'] ?? a['VARIANT'] ?? ''),
    message: String(a['MENSAJE'] ?? a['MESSAGE'] ?? a['OBSERVACIONES'] ?? ''),
    reasons: String(a['MOTIVO'] ?? a['REASON'] ?? a['REASONS'] ?? ''),
    lowerAltitude: Number(a['ALT_INF'] ?? a['LOWER_ALT'] ?? a['altInf'] ?? 0),
    upperAltitude: Number(a['ALT_SUP'] ?? a['UPPER_ALT'] ?? a['altSup'] ?? 120),
    altitudeReference: String(a['REF_ALT'] ?? a['ALT_REF'] ?? 'AGL'),
    validFrom: String(a['FECHA_INICIO'] ?? a['VALID_FROM'] ?? ''),
    validTo: String(a['FECHA_FIN'] ?? a['VALID_TO'] ?? ''),
    phone: String(a['TELEFONO'] ?? a['PHONE'] ?? ''),
    email: String(a['EMAIL'] ?? a['CORREO'] ?? ''),
    geometry: {
      type: 'Polygon',
      coordinates,
    },
  };
}

function parseNotamFeature(f: ArcGISFeature): ActiveNotam | null {
  const a = f.attributes;

  // Point geometry
  let geometry: GeoJSON.Point | GeoJSON.Polygon;
  if (f.geometry?.x != null && f.geometry?.y != null) {
    geometry = { type: 'Point', coordinates: [f.geometry.x, f.geometry.y] };
  } else if (f.geometry?.rings) {
    const coordinates = f.geometry.rings.map(ring =>
      ring.map(([x, y]) => [x, y] as [number, number])
    );
    geometry = { type: 'Polygon', coordinates };
  } else {
    return null;
  }

  // Parse dates — ENAIRE sends epoch ms or ISO strings
  const startRaw = a['FECHA_INICIO'] ?? a['START_DATE'] ?? a['startDate'];
  const endRaw = a['FECHA_FIN'] ?? a['END_DATE'] ?? a['endDate'];
  const startDate = startRaw ? new Date(startRaw as number | string) : new Date();
  const endDate = endRaw ? new Date(endRaw as number | string) : new Date(Date.now() + 86400000);

  // Skip expired NOTAMs
  if (endDate.getTime() < Date.now()) return null;

  return {
    notamId: String(a['NOTAM_ID'] ?? a['notamId'] ?? a['ID'] ?? ''),
    location: String(a['LOCALIZACION'] ?? a['LOCATION'] ?? a['location'] ?? ''),
    description: String(a['DESCRIPCION'] ?? a['DESCRIPTION'] ?? a['itemE'] ?? a['ITEM_E'] ?? ''),
    lowerAltitudeFt: Number(a['ALT_INF_FT'] ?? a['LOWER_FL'] ?? a['lowerAlt'] ?? 0),
    upperAltitudeFt: Number(a['ALT_SUP_FT'] ?? a['UPPER_FL'] ?? a['upperAlt'] ?? 0),
    lowerAltitudeAglFt: Number(a['ALT_INF_AGL_FT'] ?? a['LOWER_ALT_AGL'] ?? 0),
    startDate,
    endDate,
    qcode: String(a['QCODE'] ?? a['Q_CODE'] ?? ''),
    geometry,
  };
}

// ── Fetch functions ────────────────────────────────────────

/**
 * Fetch UAS restricted zones for a bounding box.
 * Queries all 4 layers (Aero, Infra, Medioambiente, Urbano) in parallel.
 * Cache: 24h.
 */
export async function fetchUasZones(
  bbox: [number, number, number, number],
): Promise<UasZone[]> {
  if (cachedZones.length > 0 && Date.now() - zonesCachedAt < ZONE_CACHE_TTL) {
    return cachedZones;
  }

  try {
    // Fetch all 4 layers in parallel
    const responses = await Promise.allSettled(
      UAS_LAYERS.map(layer =>
        fetch(buildQueryUrl(UAS_BASE, layer, bbox))
          .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json() as Promise<ArcGISResponse>;
          })
      )
    );

    const zones: UasZone[] = [];

    for (const result of responses) {
      if (result.status !== 'fulfilled') continue;
      const data = result.value;
      if (data.error) {
        console.debug('[ENAIRE UAS] Layer error:', data.error.message);
        continue;
      }
      if (!data.features) continue;

      for (const feature of data.features) {
        const zone = parseUasFeature(feature);
        if (zone) zones.push(zone);
      }
    }

    cachedZones = zones;
    zonesCachedAt = Date.now();
    console.debug(`[ENAIRE UAS] Fetched ${zones.length} zones`);

    return zones;
  } catch (err) {
    console.warn('[ENAIRE UAS] Fetch error:', err);
    return cachedZones; // Graceful fallback to stale cache
  }
}

/**
 * Fetch active NOTAMs for a bounding box.
 * Queries layers 0 (points) and 1 (areas) in parallel.
 * Cache: 30min.
 */
export async function fetchActiveNotams(
  bbox: [number, number, number, number],
): Promise<ActiveNotam[]> {
  if (cachedNotams.length > 0 && Date.now() - notamsCachedAt < NOTAM_CACHE_TTL) {
    return cachedNotams;
  }

  try {
    const responses = await Promise.allSettled(
      [0, 1].map(layer =>
        fetch(buildQueryUrl(NOTAM_BASE, layer, bbox))
          .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json() as Promise<ArcGISResponse>;
          })
      )
    );

    const notams: ActiveNotam[] = [];

    for (const result of responses) {
      if (result.status !== 'fulfilled') continue;
      const data = result.value;
      if (data.error) {
        console.debug('[ENAIRE NOTAM] Layer error:', data.error.message);
        continue;
      }
      if (!data.features) continue;

      for (const feature of data.features) {
        const notam = parseNotamFeature(feature);
        if (notam) notams.push(notam);
      }
    }

    // Deduplicate by notamId
    const seen = new Set<string>();
    const unique = notams.filter(n => {
      if (!n.notamId || seen.has(n.notamId)) return false;
      seen.add(n.notamId);
      return true;
    });

    cachedNotams = unique;
    notamsCachedAt = Date.now();
    console.debug(`[ENAIRE NOTAM] Fetched ${unique.length} active NOTAMs`);

    return unique;
  } catch (err) {
    console.warn('[ENAIRE NOTAM] Fetch error:', err);
    return cachedNotams; // Graceful fallback to stale cache
  }
}

/**
 * Build a bbox [minLon, minLat, maxLon, maxLat] from a center + radius.
 * Approximate: 1° lat ≈ 111 km, 1° lon ≈ 111 km × cos(lat)
 */
export function bboxFromCenter(
  center: [number, number], // [lon, lat]
  radiusKm: number,
): [number, number, number, number] {
  const [lon, lat] = center;
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}
