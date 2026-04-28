/**
 * MeteoGalicia ICA (Índice de Calidade do Aire) fetcher — S126 Phase 1b TIER 2.
 *
 * Persists every hourly observation from the Xunta's official air-quality
 * network into `ica_readings`. ~30 stations across Galicia × hourly polls.
 *
 * Reuses the pure client from `src/api/meteoGaliciaIcaClient.ts` so the
 * REST endpoint contract lives in ONE place. Network call CORS-permissive
 * (server reflects Origin), no proxy needed.
 *
 * Cadence: 30min (matches Xunta's hourly publication cadence with margin).
 * Dedup via PK (time, station) → ON CONFLICT DO NOTHING.
 *
 * Volume: ~30 stations × 24h = 720 rows/day ≈ 263K/year ≈ 25MB/year. Trivial.
 *
 * Why we want this in DB:
 *   1. Calima episode duration / spatial extent (cross-reference with
 *      Saharan dust forecasts).
 *   2. Local pollution outliers — industrial vs traffic vs fire smoke.
 *   3. Long-term trend: is air quality worsening / improving?
 */

import { getPool } from './db.js';
import { log } from './logger.js';
import { fetchIcaObservations } from '../src/api/meteoGaliciaIcaClient.js';

interface PersistedIca {
  time: Date;
  station: string;
  lat: number;
  lon: number;
  ica: number;
  categoryEs: string;
  dominant: string;
}

async function batchInsertIca(rows: PersistedIca[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getPool();

  const values: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const r of rows) {
    values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(r.time, r.station, r.lat, r.lon, r.ica, r.categoryEs, r.dominant);
  }

  const sql = `
    INSERT INTO ica_readings (time, station, lat, lon, ica, category_es, dominant)
    VALUES ${values.join(', ')}
    ON CONFLICT (time, station) DO NOTHING
  `;

  try {
    const result = await db.query(sql, params);
    return result.rowCount ?? 0;
  } catch (err) {
    log.error(`[ICA Fetcher] DB insert failed: ${(err as Error).message}`);
    return 0;
  }
}

/**
 * One poll cycle: fetch latest ICA observations from Xunta REST endpoint
 * → persist with dedup by (time, station). The frontend polls the SAME
 * endpoint every 30min for the ticker; this fetcher writes them to DB.
 */
export async function runIcaCycle(): Promise<void> {
  let observations;
  try {
    observations = await fetchIcaObservations();
  } catch (err) {
    log.warn(`[ICA Fetcher] fetch failed: ${(err as Error).message}`);
    return;
  }

  if (observations.length === 0) {
    log.info('[ICA Fetcher] poll ok — 0 observations returned');
    return;
  }

  const rows: PersistedIca[] = observations.map((o) => ({
    time: o.timestamp,
    station: o.station,
    lat: o.lat,
    lon: o.lon,
    ica: o.ica,
    categoryEs: o.categoryEs,
    dominant: o.dominantPollutant,
  }));

  const inserted = await batchInsertIca(rows);
  log.info(
    `[ICA Fetcher] poll ok — ${observations.length} observations, ${inserted} new rows persisted`,
  );
}
