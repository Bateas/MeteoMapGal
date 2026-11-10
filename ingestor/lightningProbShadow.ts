/**
 * Shadow lightning probability, stored every lightning poll for each sector point and shown
 * nowhere. Logic and frozen coefficients: lightningProbLogic.ts.
 *
 * It stores a row ALWAYS, also when the probability is close to zero: the table it will be
 * judged from has to hold the quiet hours too (storm_predictions, written by the browsers,
 * never held one and could not be used to calibrate anything).
 *
 * Storage: alert_log (alert_type 'lightning-prob-shadow'), which needs
 *   GRANT SELECT, INSERT ON alert_log TO meteomap_app;
 * Without it the figures still go to the log line, every poll, and the insert is not retried
 * until the service restarts.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import { SECTORS } from '../src/config/sectors.js';
import {
  LIGHTNING_PROB_MODEL, LIGHTNING_PROB_WINDOW_MIN, describeLightningProb, lightningProb, lightningProbInputs,
} from './lightningProbLogic.js';

const ALERT_TYPE = 'lightning-prob-shadow';
const PG_UNDEFINED_TABLE = '42P01';
const PG_NO_PRIVILEGE = '42501';
let storeOff = false;

export async function runLightningProbShadow(nowMs: number = Date.now()): Promise<void> {
  try {
    const db = getPool();
    const { rows } = await db.query<{ time: Date; lat: number; lon: number }>(
      `SELECT time, lat, lon FROM lightning_strikes
        WHERE time > NOW() - ($1 || ' minutes')::interval AND is_galicia = TRUE`,
      [String(LIGHTNING_PROB_WINDOW_MIN + 1)],
    );
    const strikes = rows.map((r) => ({ lat: Number(r.lat), lon: Number(r.lon), time: r.time }));
    const lines: string[] = [];
    for (const sector of SECTORS) {
      const [lon, lat] = sector.center;
      const p = lightningProb(lightningProbInputs(strikes, lat, lon, nowMs));
      lines.push(describeLightningProb(sector.id, p));
      if (storeOff) continue;
      try {
        await db.query(
          `INSERT INTO alert_log (time, alert_type, sector, level, score, params, hypothesis)
           VALUES (date_trunc('minute', NOW()), $1, $2, 'sombra', $3, $4::jsonb, $5)`,
          [ALERT_TYPE, sector.id, Math.round(p.p1h * 10_000) / 100,
            JSON.stringify({ p1h: Number(p.p1h.toFixed(5)), p3h: Number(p.p3h.toFixed(5)), n25: p.n25, n80: p.n80, dmin: p.dmin }),
            LIGHTNING_PROB_MODEL],
        );
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === PG_NO_PRIVILEGE || code === PG_UNDEFINED_TABLE) {
          storeOff = true;
          log.warn('[Rayos sombra] no se puede escribir en alert_log (falta GRANT SELECT, INSERT ON alert_log TO meteomap_app): las cifras quedan solo en este registro hasta reiniciar');
        } else {
          log.warn(`[Rayos sombra] no se pudo guardar ${sector.id}: ${(err as Error).message}`);
        }
      }
    }
    log.info(`[Rayos sombra] ${lines.join(' | ')}`);
  } catch (err) {
    log.warn(`[Rayos sombra] ${(err as Error).message}`);
  }
}
