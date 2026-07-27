/**
 * EFFIS / Copernicus burnt-area fetcher — pixels become named fires.
 *
 * FIRMS gives us satellite HOTSPOTS: one row per VIIRS pixel per overpass.
 * A single fire is therefore counted many times over (two platforms x up to
 * four passes a day x several 375 m pixels for one big burn), which is exactly
 * how the app ended up announcing "37 focos activos" for three real fires.
 *
 * EFFIS solves the grouping upstream. Its own words in the service metadata:
 * "Individual VIIRS hotspots are grouped in space and time to delineate
 * contiguous burnt-area polygons, updated at each acquisition cycle (up to 14
 * passes per day)". One row = one FIRE, with the attributes a pixel can never
 * carry: country, province, commune and burnt hectares.
 *
 * Wire-format notes (all verified live against the service, do not re-derive):
 *   - Host is `maps.effis.emergency.copernicus.eu/effis`. The legacy JRC host
 *     (`ies-ows.jrc.ec.europa.eu/effis`) has its vector layers down with an
 *     Oracle connection error — never point here at it.
 *   - There is NO GeoJSON output. `outputformat=geojson` returns an empty body
 *     and `application/json` returns 500. GML 3.1.1 is the only option, hence
 *     the regex parser below (same approach as `xml.ts`, zero new deps).
 *   - `maxfeatures` is MANDATORY. Without it the request hangs past 85 s.
 *   - WFS GetCapabilities does not respond at all, so nothing here may depend
 *     on capability discovery. GetFeature works fine.
 *   - The typename says "modis" but the underlying data is VIIRS (the layer
 *     Abstract says so). The name is legacy; ignore it.
 *
 * Licence: CC BY 4.0. Attribution to the European Union is MANDATORY wherever
 * this data is displayed — see EFFIS_ATTRIBUTION, which the API echoes so the
 * frontend has no excuse to drop it.
 */

import { getPool } from './db.js';
import { log } from './logger.js';

// ── Configuration ─────────────────────────────────────

const EFFIS_HOST = 'https://maps.effis.emergency.copernicus.eu/effis';
const EFFIS_TYPENAME = 'ms:modis.ba.poly.week';
/** Galicia + buffer — same box as FIRMS so both fire layers cover one area. */
const EFFIS_BBOX = '-10.0,41.5,-6.0,44.0';
/**
 * Hard cap on returned features. Mandatory (see header). A typical week in this
 * box is ~16 events and the worst August week should stay well inside 200;
 * the cycle warns when the cap is actually reached so silent truncation can't
 * hide events the way the hotspot inflation hid real fire counts.
 */
const MAX_FEATURES = 200;
/**
 * Generous on purpose: the same 100 KB payload was served in 2.9 s warm and
 * 39 s cold during the live check. Nobody is waiting on this — it is a
 * background job — so a slow upstream should be tolerated, not aborted.
 */
const FETCH_TIMEOUT_MS = 60_000;

/**
 * Mandatory CC BY 4.0 credit, in Spanish because it is meant to be rendered
 * verbatim in the UI. Served by the events endpoint so the frontend receives
 * the licence obligation together with the data it applies to.
 */
export const EFFIS_ATTRIBUTION =
  'Incendios: EFFIS — Copernicus Emergency Management Service, © Unión Europea, CC BY 4.0';

/** Galician provinces, accent-stripped, for the "is this ours?" heartbeat. */
const GALICIAN_PROVINCES = new Set(['a coruna', 'coruna', 'la coruna', 'lugo', 'ourense', 'orense', 'pontevedra']);

// ── Types ─────────────────────────────────────────────

export interface EffisFire {
  /** EFFIS event id (`ms:id`), primary key of `effis_fires`. */
  effisId: string;
  /** Ignition as reported by EFFIS (UTC). Null when the field is unusable. */
  fireDate: Date | null;
  /** Last EFFIS revision of this event (UTC). Drives the freshness guard. */
  lastUpdate: Date | null;
  country: string | null;
  province: string | null;
  commune: string | null;
  /** Burnt hectares. Small events legitimately report 0. */
  areaHa: number | null;
  /** Representative point (envelope centre). Required — a fire we cannot place is useless. */
  lat: number;
  lon: number;
  /** EFFIS window class, e.g. `7DAYS` / `30DAYS`. */
  fireClass: string | null;
  /** Percentage of the burnt area inside a Natura 2000 site. */
  pctNatura: number | null;
}

// ── Pure parsing helpers ──────────────────────────────

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
};

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)));
}

/** Text of an `<ms:NAME>` element. Absent fields are simply omitted by MapServer. */
function msField(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<ms:${name}>([\\s\\S]*?)</ms:${name}>`));
  if (!m) return null;
  const value = decodeXmlEntities(m[1].trim());
  return value === '' ? null : value;
}

function msNumber(block: string, name: string): number | null {
  const raw = msField(block, name);
  if (raw === null) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * EFFIS timestamps look like `2026-07-22 15:25:56.99` — space separated, no
 * zone marker, sometimes with microseconds. They are UTC.
 *
 * Feeding that string straight to `new Date()` parses it as LOCAL time, which
 * on the production host silently shifts every fire two hours (CEST). Hence
 * the explicit `T` + `Z`, plus truncation of sub-millisecond digits so the
 * result does not depend on how lenient the JS engine happens to be.
 */
export function parseEffisTimestamp(raw: string | null): Date | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?/);
  if (!m) return null;
  const millis = m[3] ? `.${m[3].slice(0, 3).padEnd(3, '0')}` : '';
  const date = new Date(`${m[1]}T${m[2]}${millis}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Accent/case-insensitive key used for province comparisons. */
export function normalizeProvince(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .normalize('NFD')
    // \p{M} = every combining mark, which is exactly what NFD just split
    // off. ASCII-only source: literal combining marks are invisible in an
    // editor and do not survive every encoding round-trip.
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

/** True when the event sits in one of the four Galician provinces. */
export function isGalicianProvince(province: string | null | undefined): boolean {
  return GALICIAN_PROVINCES.has(normalizeProvince(province));
}

/**
 * Representative point for a burnt-area polygon.
 *
 * Prefers the per-feature `gml:boundedBy` envelope (always present, and its
 * centre is a fair stand-in for a polygon this small). Falls back to the
 * bounding box of the raw `gml:posList` when the envelope is missing.
 *
 * GML 3.1.1 with `srsName="EPSG:4326"` is latitude-first, which the live
 * payload confirms. The magnitude check is cheap insurance in case the server
 * ever flips axis order on us: a value beyond +/-90 cannot be a latitude.
 */
function extractPoint(block: string): { lat: number; lon: number } | null {
  const lower = block.match(/<gml:lowerCorner>([^<]+)<\/gml:lowerCorner>/);
  const upper = block.match(/<gml:upperCorner>([^<]+)<\/gml:upperCorner>/);
  if (lower && upper) {
    const a = lower[1].trim().split(/\s+/).map(Number);
    const b = upper[1].trim().split(/\s+/).map(Number);
    if (a.length >= 2 && b.length >= 2 && [...a.slice(0, 2), ...b.slice(0, 2)].every(Number.isFinite)) {
      // Fall through to the polygon on a nonsensical envelope rather than
      // giving up: the coordinates are right there in the posList.
      const point = finalizePoint((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (point) return point;
    }
  }

  const posLists = block.match(/<gml:posList[^>]*>([\s\S]*?)<\/gml:posList>/g);
  if (!posLists) return null;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const listBlock of posLists) {
    const inner = listBlock.replace(/<[^>]*>/g, ' ');
    const nums = inner.trim().split(/\s+/).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const lat = nums[i], lon = nums[i + 1];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  }
  if (minLat === Infinity) return null;
  return finalizePoint((minLat + maxLat) / 2, (minLon + maxLon) / 2);
}

function finalizePoint(first: number, second: number): { lat: number; lon: number } | null {
  // Axis-order guard, see extractPoint.
  const lat = Math.abs(first) > 90 && Math.abs(second) <= 90 ? second : first;
  const lon = lat === first ? second : first;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * Parse an EFFIS WFS GML 3.1.1 FeatureCollection into fire events.
 *
 * Pure and total: any malformed, empty or truncated input yields `[]` rather
 * than an exception, because this runs inside a 24/7 loop where a parser throw
 * would be indistinguishable from "no fires".
 *
 * A feature is only emitted when its `</gml:featureMember>` is present, so a
 * response cut mid-stream contributes complete events and drops the partial
 * tail instead of persisting a half-filled row.
 */
export function parseEffisGml(xml: string): EffisFire[] {
  if (typeof xml !== 'string' || xml.length === 0) return [];
  // Upstream reports failures as an OGC exception document with HTTP 200.
  if (/ServiceExceptionReport|<ows:Exception/i.test(xml)) return [];

  const fires: EffisFire[] = [];
  const parts = xml.split(/<gml:featureMember[^>]*>/i).slice(1);

  for (const part of parts) {
    const end = part.indexOf('</gml:featureMember>');
    if (end === -1) continue; // truncated tail — not a complete feature
    const block = part.slice(0, end);

    // `ms:id` is the documented identifier; the gml:id attribute
    // (`modis.ba.poly.week.562633`) is the fallback if the element is missing.
    let effisId = msField(block, 'id');
    if (!effisId) {
      const gmlId = block.match(/gml:id="[^"]*?(\d+)"/);
      effisId = gmlId ? gmlId[1] : null;
    }
    if (!effisId) continue;

    const point = extractPoint(block);
    if (!point) continue; // unplaceable fire — nothing a map can do with it

    fires.push({
      effisId,
      fireDate: parseEffisTimestamp(msField(block, 'FIREDATE')),
      // FINALDATE is documented but absent from every live feature observed,
      // so the schema deliberately has no column for it.
      lastUpdate: parseEffisTimestamp(msField(block, 'LASTUPDATE')),
      country: msField(block, 'COUNTRY'),
      province: msField(block, 'PROVINCE'),
      commune: msField(block, 'COMMUNE'),
      areaHa: msNumber(block, 'AREA_HA'),
      lat: point.lat,
      lon: point.lon,
      fireClass: msField(block, 'CLASS'),
      pctNatura: msNumber(block, 'PERCNA2K'),
    });
  }

  return fires;
}

// ── Fetch ─────────────────────────────────────────────

/**
 * Every query parameter is a module constant, so the URL is built literally
 * rather than through URLSearchParams: this is byte-for-byte the request that
 * was verified against the live service, and there is no user input to escape.
 */
function buildEffisUrl(): string {
  return (
    `${EFFIS_HOST}?service=WFS&request=getfeature&version=1.1.0` +
    `&typename=${EFFIS_TYPENAME}&bbox=${EFFIS_BBOX}&maxfeatures=${MAX_FEATURES}`
  );
}

async function fetchEffisGml(): Promise<string | null> {
  try {
    const res = await fetch(buildEffisUrl(), {
      headers: { Accept: 'text/xml' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn(`[EFFIS] upstream ${res.status} — skipping this cycle`);
      return null;
    }
    return await res.text();
  } catch (err) {
    log.warn(`[EFFIS] fetch failed: ${(err as Error).message}`);
    return null;
  }
}

// ── DB persist ────────────────────────────────────────

/**
 * The table is created by hand on the DB host, so the service must survive its
 * absence. On `undefined_table` we stop trying for a while instead of hammering
 * the upstream and the log once every cycle; the probe re-arms itself so the
 * feature starts working on its own once the schema is applied — no restart.
 */
const TABLE_RETRY_MS = 6 * 60 * 60_000;
let tableUnavailableUntil = 0;

/** PG error codes we can act on. */
const PG_UNDEFINED_TABLE = '42P01';
const PG_INSUFFICIENT_PRIVILEGE = '42501';

interface PersistResult {
  inserted: number;
  updated: number;
  failed: number;
  /** Set when the cycle must abort: schema not ready. */
  aborted: boolean;
}

/**
 * Row-at-a-time upsert. Volume is a couple of dozen rows an hour, so the cost
 * of individual statements is irrelevant and the isolation is worth it: one
 * event with a surprising value cannot take the rest of the batch down with it.
 *
 * The `WHERE` on the conflict path refuses to overwrite a newer revision with
 * an older one, which also makes re-running the cycle a no-op.
 */
async function upsertFires(fires: EffisFire[]): Promise<PersistResult> {
  const out: PersistResult = { inserted: 0, updated: 0, failed: 0, aborted: false };
  if (fires.length === 0) return out;

  const db = getPool();
  // `class` is quoted throughout: it is not a PostgreSQL keyword, but the
  // quotes make it unmistakably a column name to whoever reads this next.
  // `xmax = 0` is the usual new-vs-updated tell; it only feeds the log line,
  // so the corner cases it is famous for cannot affect stored data.
  const sql = `
    INSERT INTO effis_fires
      (effis_id, fire_date, last_update, country, province, commune,
       area_ha, lat, lon, "class", pct_natura, fetched_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    ON CONFLICT (effis_id) DO UPDATE SET
      fire_date   = EXCLUDED.fire_date,
      last_update = EXCLUDED.last_update,
      country     = EXCLUDED.country,
      province    = EXCLUDED.province,
      commune     = EXCLUDED.commune,
      area_ha     = EXCLUDED.area_ha,
      lat         = EXCLUDED.lat,
      lon         = EXCLUDED.lon,
      "class"     = EXCLUDED."class",
      pct_natura  = EXCLUDED.pct_natura,
      fetched_at  = NOW()
    WHERE effis_fires.last_update IS NULL
       OR EXCLUDED.last_update IS NULL
       OR EXCLUDED.last_update >= effis_fires.last_update
    RETURNING (xmax = 0) AS is_new
  `;

  for (const f of fires) {
    try {
      const result = await db.query<{ is_new: boolean }>(sql, [
        f.effisId, f.fireDate, f.lastUpdate, f.country, f.province, f.commune,
        f.areaHa, f.lat, f.lon, f.fireClass, f.pctNatura,
      ]);
      // No row back means the freshness guard rejected an older revision.
      if (result.rows.length === 0) continue;
      if (result.rows[0].is_new) out.inserted++;
      else out.updated++;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === PG_UNDEFINED_TABLE) {
        tableUnavailableUntil = Date.now() + TABLE_RETRY_MS;
        log.warn(
          '[EFFIS] table `effis_fires` does not exist — named-fire events will not be stored. ' +
            'Apply the schema on the database host, then the fetcher picks it up on its own ' +
            `(next probe in ${Math.round(TABLE_RETRY_MS / 3_600_000)}h, no restart needed).`,
        );
        out.aborted = true;
        return out;
      }
      if (code === PG_INSUFFICIENT_PRIVILEGE) {
        tableUnavailableUntil = Date.now() + TABLE_RETRY_MS;
        log.warn(
          '[EFFIS] no permission on `effis_fires` — the upsert needs SELECT, INSERT and UPDATE ' +
            'granted to the application role. Nothing is being stored until that is fixed.',
        );
        out.aborted = true;
        return out;
      }
      out.failed++;
      log.debug(`[EFFIS] upsert failed for event ${f.effisId}: ${(err as Error).message}`);
    }
  }

  return out;
}

// ── Public entry ──────────────────────────────────────

/**
 * One EFFIS poll: fetch the weekly burnt-area layer for the Galicia box, parse
 * the GML and upsert each event.
 *
 * Fail-soft by construction — every failure path logs and returns, so the
 * caller can fire-and-forget it without a chance of taking the ingestor down.
 *
 * The closing heartbeat prints on EVERY cycle, including quiet ones: a fire
 * layer that only logs when something burns is indistinguishable from a fire
 * layer that is broken.
 */
export async function runEffisCycle(): Promise<void> {
  if (Date.now() < tableUnavailableUntil) {
    log.debug('[EFFIS] skipped — waiting for `effis_fires` to exist');
    return;
  }

  const xml = await fetchEffisGml();
  if (xml === null) return;

  const fires = parseEffisGml(xml);
  if (fires.length === 0) {
    // Genuinely possible in winter, and also what a format change would look
    // like — worth a line either way, but not an alarm.
    log.info('[EFFIS] cycle ok — 0 fire events in the area this week');
    return;
  }

  if (fires.length >= MAX_FEATURES) {
    log.warn(
      `[EFFIS] hit the ${MAX_FEATURES}-feature cap — some events may be missing. ` +
        'Raise MAX_FEATURES if this repeats during fire season.',
    );
  }

  const galicia = fires.filter((f) => isGalicianProvince(f.province));
  const { inserted, updated, failed, aborted } = await upsertFires(fires);
  if (aborted) return;

  const biggest = galicia.reduce<EffisFire | null>(
    (best, f) => (best === null || (f.areaHa ?? 0) > (best.areaHa ?? 0) ? f : best),
    null,
  );
  const galiciaDetail = biggest
    ? `, biggest in Galicia: ${biggest.commune ?? 'unknown'} (${biggest.areaHa ?? 0} ha)`
    : '';

  log.info(
    `[EFFIS] cycle ok — ${fires.length} fire events, ${galicia.length} in Galicia, ` +
      `${inserted} new, ${updated} updated${failed > 0 ? `, ${failed} failed` : ''}${galiciaDetail}`,
  );
}
