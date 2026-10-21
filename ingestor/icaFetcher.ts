/**
 * MeteoGalicia ICA (Índice de Calidade do Aire) fetcher  Phase 1b TIER 2.
 *
 * Persists every hourly observation from the Xunta's official air-quality
 * network into `ica_readings`. ~30 stations across Galicia × hourly polls.
 *
 * Reuses the pure client from `src/api/meteoGaliciaIcaClient.ts` so the
 * contract with the source lives in ONE place: MeteoGalicia's official
 * jsonICAActual.action since v2.178.23 (before, the IDEG map layer of their
 * viewer, which is not for third parties). Asked directly from the server.
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
import { fetchIcaObservationsChecked } from '../src/api/meteoGaliciaIcaClient.js';

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
 * A run of failed or empty polls of the ICA source, so the log says it ONCE.
 *
 * Until 21-oct-2026 an HTTP error or a body that was not JSON came back as `[]` and was logged as
 * «poll ok — 0 observations» at DEBUG (off by default): a cut of the source would have been
 * invisible for as long as it lasted. Now the first bad poll of a run is a WARN with the reason,
 * the rest of the run goes to DEBUG (the poll is every 30 min; a WARN each time would be read
 * once and then ignored), and the first good poll says how long it lasted.
 */
export interface IcaEpisode {
  failingSince: number | null;
  failures: number;
}

export type IcaOutcome =
  | { kind: 'ok'; count: number }
  | { kind: 'empty' }
  | { kind: 'error'; reason: string };

export interface IcaLogLine {
  level: 'warn' | 'info' | 'debug';
  msg: string;
}

/** Next episode state and the line to log for this poll (null = nothing beyond the usual). Pure. */
export function icaEpisodeStep(prev: IcaEpisode, outcome: IcaOutcome, now: number): { next: IcaEpisode; line: IcaLogLine | null } {
  if (outcome.kind === 'ok') {
    if (prev.failingSince == null) return { next: prev, line: null };
    const min = Math.round((now - prev.failingSince) / 60_000);
    return {
      next: { failingSince: null, failures: 0 },
      line: { level: 'info', msg: `[ICA Fetcher] back after ${prev.failures} bad poll(s) (${min} min)` },
    };
  }
  const reason = outcome.kind === 'empty'
    ? 'MeteoGalicia answered with no usable station (0 observations)'
    : `fetch failed: ${outcome.reason}`;
  if (prev.failingSince == null) {
    return {
      next: { failingSince: now, failures: 1 },
      line: { level: 'warn', msg: `[ICA Fetcher] ${reason} — said once; repeats go to DEBUG until it is back` },
    };
  }
  return {
    next: { failingSince: prev.failingSince, failures: prev.failures + 1 },
    line: { level: 'debug', msg: `[ICA Fetcher] still failing (${prev.failures + 1} polls): ${reason}` },
  };
}

let episode: IcaEpisode = { failingSince: null, failures: 0 };

function note(outcome: IcaOutcome): void {
  const { next, line } = icaEpisodeStep(episode, outcome, Date.now());
  episode = next;
  if (line) log[line.level](line.msg);
}

/**
 * One poll cycle: fetch latest ICA observations from MeteoGalicia's JSON service
 * → persist with dedup by (time, station). The frontend polls the SAME
 * endpoint every 30min for the ticker; this fetcher writes them to DB.
 */
export async function runIcaCycle(): Promise<void> {
  let observations;
  try {
    observations = await fetchIcaObservationsChecked();
  } catch (err) {
    note({ kind: 'error', reason: (err as Error).message });
    return;
  }

  if (observations.length === 0) {
    note({ kind: 'empty' });
    return;
  }
  note({ kind: 'ok', count: observations.length });

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
