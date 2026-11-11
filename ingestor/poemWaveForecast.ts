/**
 * Archive of Puertos del Estado's nearshore wave forecast (SAPO meshes of Vigo and Pontevedra and
 * the Rias Baixas mesh: 94 points, hourly, 72 h), through POEM with the token the buoys already use.
 *
 * Why: the map estimates the wave at each beach from an open-sea height; these points sit inside the
 * rias and a few km off the surf beaches. Kept so the forecast can be compared with what was measured
 * and seen, run by run. Nothing reads the table yet and nothing is shown.
 *
 * Cost: one request every 3 h to ask when each mesh last ran, and four more per mesh run
 * (25 points each). Values are stored as sent; see poemWaveForecastLogic.ts.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import { poemGet, poemToken, PoemHttpError } from './poemClient.js';
import {
  WAVE_MESHES, chunk, forecastInsertParts, forecastRows, meshPoints, meshRuns, type WavePoint,
} from './poemWaveForecastLogic.js';

export const POEM_WAVE_EVERY_MS = 3 * 3_600_000;
const POINTS_TTL_MS = 24 * 3_600_000;
const CODES_PER_REQUEST = 25;
const ROWS_LIMIT = '2500';
const INSERT_BATCH = 400;
const PAUSE_MS = 1_500;
/** POEM reads a list of values separated by this as «any of». */
const ANY_OF = '|';

let running = false;
let disabled = false;
let points: WavePoint[] = [];
let pointsAt = 0;
/** Mesh -> epoch seconds of the last run saved. Filled from the table on the first pass. */
let savedRun: Map<string, number> | null = null;

const meshFilter = WAVE_MESHES.join(ANY_OF);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadSavedRuns(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const res = await getPool().query<{ mesh: string; run: string }>(
    `SELECT mesh, EXTRACT(EPOCH FROM MAX(run_time))::bigint AS run
       FROM poem_wave_forecast WHERE run_time > NOW() - INTERVAL '10 days' GROUP BY mesh`,
  );
  for (const r of res.rows) out.set(r.mesh, Number(r.run));
  return out;
}

async function refreshPoints(token: string, nowMs: number): Promise<void> {
  if (points.length > 0 && nowMs - pointsAt < POINTS_TTL_MS) return;
  const fresh = meshPoints(await poemGet('/modelos/siwana/punto_malla', { malla: meshFilter, Limit: '500' }, token));
  if (fresh.length === 0) return;
  points = fresh;
  pointsAt = nowMs;
  const values: unknown[] = [];
  const tuples = fresh.map((p, i) => {
    values.push(p.code, p.mesh, p.lat, p.lon, p.kind);
    const b = i * 5;
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
  });
  await getPool().query(
    `INSERT INTO poem_wave_points (code, mesh, latitude, longitude, kind) VALUES ${tuples.join(',')}
     ON CONFLICT (code) DO UPDATE SET mesh = EXCLUDED.mesh, latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude, kind = EXCLUDED.kind, last_seen = NOW()`,
    values,
  );
}

/** Fire-and-forget from index.ts. Never throws. */
export async function runPoemWaveForecast(nowMs = Date.now()): Promise<void> {
  const token = poemToken();
  if (running || disabled || !token) return;
  running = true;
  try {
    if (!savedRun) savedRun = await loadSavedRuns();
    const known = savedRun;
    const runs = meshRuns(await poemGet('/modelos/siwana/nombre_malla', { malla: meshFilter, Limit: '20' }, token));
    const pending = [...runs].filter(([mesh, run]) => (known.get(mesh) ?? 0) < run);
    if (pending.length === 0) return;
    await refreshPoints(token, nowMs);
    const meshOf = new Map(points.map((p) => [p.code, p.mesh]));
    for (const [mesh, run] of pending) {
      const codes = points.filter((p) => p.mesh === mesh).map((p) => p.code);
      let saved = 0;
      for (const group of chunk(codes, CODES_PER_REQUEST)) {
        await pause(PAUSE_MS);
        const payload = await poemGet(
          '/modelos/siwana/wana_pred',
          { codigo: group.join(ANY_OF), OrderBy: 'fecha.asc', Limit: ROWS_LIMIT },
          token,
        );
        const rows = forecastRows(payload, meshOf, runs);
        for (const batch of chunk(rows, INSERT_BATCH)) {
          const { tuples, values } = forecastInsertParts(batch);
          await getPool().query(
            `INSERT INTO poem_wave_forecast (code, mesh, run_time, time, mt_hm0, mt_tp, mt_tm02, mt_dmd, mf1_hm0, mv_hm0, vv_imd, vv_dmd)
             VALUES ${tuples.join(',')} ON CONFLICT (code, run_time, time) DO NOTHING`,
            values,
          );
        }
        saved += rows.length;
      }
      if (saved > 0) known.set(mesh, run);
      log.info(`[Olas POEM] malla ${mesh}, pasada ${new Date(run * 1000).toISOString().slice(0, 16)}Z: ${saved} horas de ${codes.length} puntos`);
    }
  } catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === '42P01' || e.code === '42703') {
      disabled = true;
      log.warn('[Olas POEM] faltan las tablas poem_wave_*: aplicar ingestor/schema.sql en la base; parado hasta el proximo reinicio');
    } else if (err instanceof PoemHttpError && (err.status === 401 || err.status === 403)) {
      log.warn(`[Olas POEM] POEM rechaza la peticion (HTTP ${err.status}): sin guardar esta pasada`);
    } else {
      log.warn(`[Olas POEM] fallo: ${e.message}`);
    }
  } finally {
    running = false;
  }
}
