import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  dispatchMagicWindowAlert, dispatchWindSafetyAlert, dispatchForecastAlert, dispatchSpotAlert, dispatchLightningAlert,
  resetCooldowns, seedCooldowns, setSendRecorder, type SentRecord,
} from './alertDispatcher';
import { log } from './logger';

describe('alertDispatcher — every message that goes out leaves its full text in the log', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 12, 0)); // midday local: outside the night silence
    resetCooldowns();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('logs the type and the exact text once the webhook accepts it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const info = vi.spyOn(log, 'info').mockImplementation(() => {});
    await dispatchMagicWindowAlert('Rias Baixas', 80, 'SW sinoptico y brisa', 3);
    expect(info).toHaveBeenCalledWith('Telegram enviado [magic-window]: "SW sinoptico y brisa (estimacion 3h)"');
  });

  it('logs nothing as sent when the webhook refuses it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    const info = vi.spyOn(log, 'info').mockImplementation(() => {});
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    await dispatchMagicWindowAlert('Rias Baixas', 80, 'SW sinoptico y brisa', 3);
    expect(info.mock.calls.some(([m]) => String(m).startsWith('Telegram enviado'))).toBe(false);
  });
});

describe('alertDispatcher — sends are stored and cooldowns survive a restart (29-sep)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 12, 0));
    resetCooldowns();
    vi.spyOn(log, 'info').mockImplementation(() => {});
    vi.spyOn(log, 'ok').mockImplementation(() => {});
  });
  afterEach(() => {
    setSendRecorder(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('hands every accepted send to the recorder with its cooldown key and level', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const stored: SentRecord[] = [];
    setSendRecorder(async (r) => { stored.push(r); });
    await dispatchWindSafetyAlert('rias', 'peligro', 'VIENTO MUY FUERTE — Rías Baixas', '*VIENTO MUY FUERTE*\nOns 46');
    expect(stored).toEqual([{ key: 'wind:rias', type: 'wind-safety', level: 'peligro', title: 'VIENTO MUY FUERTE — Rías Baixas', message: '*VIENTO MUY FUERTE*\nOns 46', sector: 'rias' }]);
  });

  it('a restored cooldown holds the next send back (the three identical forecasts of 29-sep)', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const now = Date.now();
    expect(seedCooldowns([
      { key: 'forecast:Embalse', atMs: now - 30 * 60_000, level: 'info' },
      { key: 'spot:cies-ria', atMs: now - 30 * 60_000, level: 'moderate' },
    ])).toBe(2);
    await dispatchForecastAlert('Embalse', 'Viento probable 12-19h', 'high');
    await dispatchSpotAlert('cies-ria', 'Cíes-Ría', 'Rías Baixas', 'BUENO', 15, 'S');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a restored lightning PELIGRO still lets nothing lower through, and a missing send restores nothing', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    seedCooldowns([{ key: 'lightning:Rias Baixas', atMs: Date.now() - 10 * 60_000, level: 'peligro' }]);
    await dispatchLightningAlert('Rias Baixas', 'aviso', ['Cesantes: rayo a 12 km']);
    expect(fetch).not.toHaveBeenCalled();
    await dispatchLightningAlert('Embalse', 'aviso', ['Castrelo: rayo a 14 km']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
