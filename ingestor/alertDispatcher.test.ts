import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dispatchMagicWindowAlert, resetCooldowns } from './alertDispatcher';
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
