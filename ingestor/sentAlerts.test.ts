/**
 * What was sent has to survive a restart: stored when the webhook accepts it, read back at startup, and turned into the
 * same cooldowns. The dispatcher's side had tests with hand-made records; nothing went through the table and back, so a
 * column or a key renamed on one side only would have brought back the three identical messages of 29-sep in silence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface Row { time: Date; alert_id: string; category: string; severity: string; title: string; detail: string; sector: string }
const table = vi.hoisted(() => ({ rows: [] as Row[], fail: false }));

// The two statements sentAlerts.ts runs, over an array: enough to tell a wrong column or a dropped filter.
vi.mock('./db.js', () => ({
  getPool: () => ({
    query: async (sql: string, params: unknown[]) => {
      if (table.fail) throw new Error('connection refused');
      if (/^\s*INSERT INTO alerts/.test(sql)) {
        const [alert_id, category, severity, title, detail, sector] = params as string[];
        table.rows.push({ time: new Date(), alert_id, category, severity, title, detail, sector });
        return { rows: [] };
      }
      // Each clause of the SELECT does its part only if the statement still carries it.
      const channelOnly = sql.includes("category LIKE 'telegram:%'");
      const windowed = sql.includes('time > NOW() - make_interval(hours => $1::int)');
      const lastPerKey = sql.includes('DISTINCT ON (alert_id)') && sql.includes('ORDER BY alert_id, time DESC');
      const sinceMs = Date.now() - Number(params[0]) * 3_600_000;
      const kept = table.rows.filter((r) => (!channelOnly || r.category.startsWith('telegram:')) && (!windowed || r.time.getTime() > sinceMs));
      const pick = ({ alert_id, time, severity }: Row) => ({ alert_id, time, severity });
      if (!lastPerKey) return { rows: kept.map(pick) };
      const last = new Map<string, Row>();
      for (const r of kept) {
        const cur = last.get(r.alert_id);
        if (!cur || cur.time < r.time) last.set(r.alert_id, r);
      }
      return { rows: [...last.values()].map(pick) };
    },
  }),
}));

import { recordSent, loadRecentSends } from './sentAlerts';
import {
  dispatchSpotAlert, dispatchWindSafetyAlert, dispatchLightningAlert, resetCooldowns, seedCooldowns, setSendRecorder,
} from './alertDispatcher';
import { log } from './logger';

const HOUR = 3_600_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 24, 12, 0)); // midday local: outside the night silence
  table.rows = [];
  table.fail = false;
  resetCooldowns();
  setSendRecorder(recordSent);
  vi.spyOn(log, 'info').mockImplementation(() => {});
  vi.spyOn(log, 'ok').mockImplementation(() => {});
  vi.spyOn(log, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  setSendRecorder(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A restart: the memory is gone, the table is not. */
async function restart(): Promise<number> {
  resetCooldowns();
  return seedCooldowns(await loadRecentSends());
}

describe('sent alerts across a restart', () => {
  it('stores each accepted send under its cooldown key, with the channel in the category', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    await dispatchSpotAlert('cies-ria', 'Cíes-Ría', 'Rías Baixas', 'BUENO', 15, 'S');
    await dispatchWindSafetyAlert('rias', 'peligro', 'VIENTO MUY FUERTE', 'Ons 46');
    expect(table.rows.map((r) => [r.alert_id, r.category, r.severity])).toEqual([
      ['spot:cies-ria', 'telegram:spot-alert', 'moderate'],
      ['wind:rias', 'telegram:wind-safety', 'peligro'],
    ]);
    expect(table.rows[1].detail).toBe('Ons 46');
  });

  it('does not store what the webhook refused', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    await dispatchSpotAlert('cies-ria', 'Cíes-Ría', 'Rías Baixas', 'BUENO', 15, 'S');
    expect(table.rows).toEqual([]);
  });

  it('no duplicates: the spot announced before the restart is not announced again inside its two hours', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    await dispatchSpotAlert('cies-ria', 'Cíes-Ría', 'Rías Baixas', 'BUENO', 15, 'S');
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(40 * 60_000);
    expect(await restart()).toBe(1);
    await dispatchSpotAlert('cies-ria', 'Cíes-Ría', 'Rías Baixas', 'BUENO', 16, 'S');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('no silence: once the two hours are over, the restored cooldown lets the next one out', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    await dispatchSpotAlert('cies-ria', 'Cíes-Ría', 'Rías Baixas', 'BUENO', 15, 'S');
    vi.advanceTimersByTime(2 * HOUR + 60_000);
    await restart();
    await dispatchSpotAlert('cies-ria', 'Cíes-Ría', 'Rías Baixas', 'BUENO', 16, 'S');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('no silence either for a spot that was never announced', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    await dispatchSpotAlert('cies-ria', 'Cíes-Ría', 'Rías Baixas', 'BUENO', 15, 'S');
    await restart();
    await dispatchSpotAlert('cesantes', 'Cesantes', 'Rías Baixas', 'BUENO', 14, 'SW');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a lightning PELIGRO comes back with its level, so a lower one stays held', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    await dispatchLightningAlert('Rias Baixas', 'peligro', ['Cesantes: rayo a 4 km']);
    expect(table.rows[0]).toMatchObject({ alert_id: 'lightning:Rias Baixas', severity: 'peligro' });
    vi.advanceTimersByTime(10 * 60_000);
    await restart();
    await dispatchLightningAlert('Rias Baixas', 'aviso', ['Cesantes: rayo a 12 km']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reads back only the last send of each key, and nothing older than the window', async () => {
    const at = (hoursAgo: number, alert_id: string, category = 'telegram:spot'): Row =>
      ({ time: new Date(Date.now() - hoursAgo * HOUR), alert_id, category, severity: 'moderate', title: '', detail: '', sector: 'rias' });
    table.rows = [at(30, 'spot:vao'), at(5, 'spot:cesantes'), at(1, 'spot:cesantes'), at(1, 'spot:lourido', 'map:spot')];
    const sends = await loadRecentSends();
    expect(sends).toEqual([{ key: 'spot:cesantes', atMs: Date.now() - HOUR, level: 'moderate' }]);
  });

  it('with the table out of reach the cooldowns start empty, and it says so', async () => {
    table.fail = true;
    expect(await loadRecentSends()).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('cooldowns start empty'));
  });
});
