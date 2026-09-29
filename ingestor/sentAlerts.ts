/**
 * Every message the automation webhook accepted, stored in the `alerts` table (created long ago,
 * empty until now; the service already has INSERT and SELECT on it). Two uses:
 *
 * - Judging afterwards what went out, with its exact text, against the readings. The log line
 *   «Telegram enviado» says the same, but a table can be queried next to spot_scores and buoys.
 * - Restoring the cooldowns after a restart (seedCooldowns and friends). They lived in memory, so
 *   each deploy forgot them: on 29-sep three deploys in forty minutes resent the same forecast.
 *
 * Columns: alert_id = cooldown key (`spot:cies-ria`, `wind:rias`, ...), category = `telegram:<type>`,
 * severity = the alert level where it has one (aviso/peligro), else its severity, detail = the text.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import type { PastSend, SentRecord } from './alertDispatcher.js';

export async function recordSent(r: SentRecord): Promise<void> {
  await getPool().query(
    `INSERT INTO alerts (time, alert_id, category, severity, title, detail, sector)
     VALUES (NOW(), $1, $2, $3, $4, $5, $6)
     ON CONFLICT (time, alert_id) DO NOTHING`,
    [r.key, `telegram:${r.type}`, r.level, r.title, r.message, r.sector],
  );
}

/** The last send per cooldown key over the longest cooldown there is (12 h, fire watch) plus
 *  margin. Empty on error: the cooldowns then start empty, as they always did. */
export async function loadRecentSends(hours = 24): Promise<PastSend[]> {
  try {
    const result = await getPool().query<{ alert_id: string; time: Date; severity: string }>(
      `SELECT DISTINCT ON (alert_id) alert_id, time, severity
         FROM alerts
        WHERE category LIKE 'telegram:%' AND time > NOW() - make_interval(hours => $1::int)
        ORDER BY alert_id, time DESC`,
      [hours],
    );
    return result.rows.map((r) => ({ key: r.alert_id, atMs: new Date(r.time).getTime(), level: r.severity }));
  } catch (err) {
    log.warn(`Recent sends not loaded (cooldowns start empty): ${(err as Error).message}`);
    return [];
  }
}
