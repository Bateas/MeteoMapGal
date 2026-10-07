/**
 * IDEG lightning archive: the discharges of MeteoGalicia's own lightning viewer (public map service
 * of the Xunta), intra-cloud included, stored as published with the minute we first saw each one.
 * See idegLightningRows.ts for why.
 *
 * Shadow only: nothing reads this table to alert. It answers two questions before anything uses it:
 * do intra-cloud discharges warn earlier than ground strikes, and how late does this service publish
 * (fetched_at - time)? It could also replace the feed MeteoGalicia asked third parties not to use.
 *
 * One query per pass, limited to the Galicia box and to what is new: the first pass after a start asks
 * for the 24 h the layer keeps, later ones for the last 30 min (repeats are absorbed by the key).
 * Every 2 min while there is fresh activity in the box, every 5 min otherwise. Never throws, never
 * blocks the poll; a missing table stops it until the next restart. Off unless IDEG_LIGHTNING=1 (index.ts).
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import { idegLightningRows, idegHasMore, type IdegLightningRow } from './idegLightningRows.js';

const LAYER = 'https://ideg.xunta.gal/meteogalicia/rest/services/METEO2_WS/Observacion_raios_ultimas_24h/MapServer/1/query';
// Same box as lightning_strikes.is_galicia (N 44.5 / S 41.5 / W -10.5 / E -6.0).
const GALICIA_BOX = '-10.5,41.5,-6.0,44.5';
const PAGE = 2000;               // the layer's maxRecordCount
const MAX_PAGES = 10;
export const IDEG_QUIET_MS = 5 * 60_000;
export const IDEG_ACTIVE_MS = 2 * 60_000;

let filledAfterStart = false;
let running = false;
let disabled = false;

const pad = (n: number) => String(n).padStart(2, '0');
/** ArcGIS timestamp literal; the service reads it as UTC (checked 8-oct). */
function utcLiteral(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function idegQueryUrl(since: Date, offset: number): string {
  const p = new URLSearchParams({
    where: `Fecha >= timestamp '${utcLiteral(since)}'`,
    geometry: GALICIA_BOX,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'idDescargas,Fecha,PeakCurrent,CloudInd,Multiplicidad,Nsensores,SemiEjeMayor,SemiEjeMenor,ChiSquare',
    orderByFields: 'Fecha',
    returnGeometry: 'true',
    outSR: '4326',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    f: 'json',
  });
  return `${LAYER}?${p.toString()}`;
}

const COLS = 12;

async function insert(rows: IdegLightningRow[]): Promise<number> {
  let added = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const values: unknown[] = [];
    const now = new Date();
    const tuples = chunk.map((r, k) => {
      values.push(r.time, r.lat, r.lon, r.peakCurrent, r.intraCloud, r.multiplicity, r.sensors,
        r.semiMajor, r.semiMinor, r.chiSquare, r.sourceId, now);
      return `(${Array.from({ length: COLS }, (_, j) => `$${k * COLS + j + 1}`).join(',')})`;
    });
    const res = await getPool().query(
      `INSERT INTO lightning_ideg (time, lat, lon, peak_current, intra_cloud, multiplicity, sensors,
         semi_major, semi_minor, chi_square, source_id, fetched_at)
       VALUES ${tuples.join(',')}
       ON CONFLICT (time, lat, lon) DO NOTHING`,
      values,
    );
    added += res.rowCount ?? 0;
  }
  return added;
}

/** One pass. Returns the delay until the next one (shorter while there is fresh activity). */
export async function runIdegLightningArchive(): Promise<number> {
  if (disabled) return IDEG_QUIET_MS;
  if (running) return IDEG_ACTIVE_MS;
  running = true;
  const since = new Date(Date.now() - (filledAfterStart ? 30 : 24 * 60) * 60_000);
  try {
    const rows: IdegLightningRow[] = [];
    let pages = 0;
    for (let offset = 0; pages < MAX_PAGES; offset += PAGE) {
      const res = await fetch(idegQueryUrl(since, offset), {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; MeteoMapGal/1.0; +https://meteomapgal.navia3d.com)' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        log.warn(`[IDEG rayos] HTTP ${res.status}`);
        return IDEG_QUIET_MS;
      }
      const body: unknown = await res.json();
      if ((body as { error?: unknown }).error) {
        log.warn(`[IDEG rayos] el servicio respondio con error: ${JSON.stringify((body as { error: unknown }).error).slice(0, 200)}`);
        return IDEG_QUIET_MS;
      }
      rows.push(...idegLightningRows(body));
      pages++;
      if (!idegHasMore(body)) break;
    }
    const added = await insert(rows);
    filledAfterStart = true;
    const intra = rows.filter((r) => r.intraCloud).length;
    const fresh = rows.filter((r) => Date.now() - r.time.getTime() <= 30 * 60_000).length;
    if (rows.length > 0 || pages > 1) {
      log.info(`[IDEG rayos] ${added} nuevos de ${rows.length} leidos (${intra} entre nubes)${pages >= MAX_PAGES ? ' — tope de paginas' : ''}`);
    }
    return fresh > 0 ? IDEG_ACTIVE_MS : IDEG_QUIET_MS;
  } catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === '42P01') {
      disabled = true;
      log.warn('[IDEG rayos] falta la tabla lightning_ideg: aplicar ingestor/schema.sql en la base; el archivo queda parado hasta el proximo reinicio');
    } else {
      log.warn(`[IDEG rayos] fallo: ${e.message}`);
    }
    return IDEG_QUIET_MS;
  } finally {
    running = false;
  }
}
