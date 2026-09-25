/**
 * Fills stations.altitude_dem for stations whose network reports no altitude, from public
 * terrain tiles (see demElevation.ts for the source and how well it matches official values).
 *
 * Runs after each discovery and looks up only the stations still missing one, so after the
 * first run it touches only new stations: a one-time download of ~150 tiles, then almost
 * nothing. Never blocks polling and never throws; a tile that fails is simply tried again after
 * the next discovery. The network's own altitude column is left untouched: the DEM value lives
 * beside it and readers prefer the network's figure when it has one.
 *
 * A station that moves keeps the altitude of where it was first seen. Wunderground stations
 * rarely move; clearing altitude_dem for one is enough to have it looked up again.
 */
import { getPool, hasColumn } from './db.js';
import { log } from './logger.js';
import { DEM_TILE_URL, DEM_ZOOM, tilePixel, terrariumMeters, stationAltitudeFromDem } from './demElevation.js';

const TILE_TIMEOUT_MS = 15_000;
const CONCURRENCY = 4;
let warnedNoColumn = false;

interface Pending { id: string; px: number; py: number }

let running = false;

export async function resolveMissingAltitudes(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // The column is added in the database separately; until it exists there is nowhere to write.
    if (!(await hasColumn('stations', 'altitude_dem'))) {
      if (!warnedNoColumn) log.warn('DEM altitude: stations.altitude_dem does not exist yet (see schema.sql); skipping');
      warnedNoColumn = true;
      return;
    }
    const db = getPool();
    const { rows } = await db.query<{ station_id: string; latitude: number; longitude: number }>(`
      SELECT station_id, latitude, longitude FROM stations
      WHERE (altitude IS NULL OR altitude <= 0) AND altitude_dem IS NULL
        AND latitude <> 0 AND longitude <> 0
    `);
    if (rows.length === 0) return;

    const byTile = new Map<string, { x: number; y: number; items: Pending[] }>();
    for (const r of rows) {
      const t = tilePixel(r.latitude, r.longitude, DEM_ZOOM);
      const key = `${t.x}/${t.y}`;
      const entry = byTile.get(key) ?? { x: t.x, y: t.y, items: [] };
      entry.items.push({ id: r.station_id, px: t.px, py: t.py });
      byTile.set(key, entry);
    }

    const sharp = (await import('sharp')).default;
    const ids: string[] = [];
    const alts: number[] = [];
    let failedTiles = 0;
    const tiles = [...byTile.values()];
    for (let i = 0; i < tiles.length; i += CONCURRENCY) {
      await Promise.all(tiles.slice(i, i + CONCURRENCY).map(async (t) => {
        try {
          const res = await fetch(`${DEM_TILE_URL}/${DEM_ZOOM}/${t.x}/${t.y}.png`, { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
          for (const s of t.items) {
            const k = (s.py * info.width + s.px) * info.channels;
            const alt = stationAltitudeFromDem(terrariumMeters(data[k], data[k + 1], data[k + 2]));
            if (alt != null) { ids.push(s.id); alts.push(alt); }
          }
        } catch {
          failedTiles++;
        }
      }));
    }

    let written = 0;
    if (ids.length > 0) {
      const res = await db.query(
        `UPDATE stations s SET altitude_dem = v.alt
         FROM unnest($1::text[], $2::double precision[]) AS v(id, alt)
         WHERE s.station_id = v.id`,
        [ids, alts],
      );
      written = res.rowCount ?? 0;
    }
    const failed = failedTiles > 0 ? `; ${failedTiles} tiles failed, retried after the next discovery` : '';
    log.info(`DEM altitude: ${written}/${rows.length} stations filled from ${tiles.length} tiles${failed}`);
  } catch (err) {
    log.warn(`DEM altitude lookup failed: ${(err as Error).message}`);
  } finally {
    running = false;
  }
}
