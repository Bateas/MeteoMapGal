import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  dispatchMagicWindowAlert, dispatchWindSafetyAlert, dispatchForecastAlert, dispatchSpotAlert, dispatchLightningAlert,
  dispatchFireWatchDigest, fireWatchAlertedZones,
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

describe('alertDispatcher — spot alerts say which wind it is, never the sea (1-oct)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 17, 0));
    resetCooldowns();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const sentText = async (spot: string, dir: string, kt = 10) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    vi.spyOn(log, 'info').mockImplementation(() => {});
    vi.spyOn(log, 'ok').mockImplementation(() => {});
    resetCooldowns();
    await dispatchSpotAlert(spot, spot, 'Rías Baixas', 'NAVEGABLE', kt, dir, { gustKt: 17 });
    const body = fetch.mock.calls.at(-1)?.[1]?.body;
    fetch.mockRestore();
    return body ? (JSON.parse(String(body)) as { text: string }).text : '';
  };

  it('the 1-oct Cies alert no longer promises heavy seas', async () => {
    const text = await sentText('cies-ria', 'N');
    expect(text).toContain('N 10kt (rachas 17kt)');
    expect(text).toContain('Nortada');
    expect(text).not.toMatch(/oleaje/i);
  });

  it('no spot and no direction claims sea state, swell or ideal conditions', async () => {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    for (const spot of ['castrelo', 'cesantes', 'lourido', 'bocana', 'centro-ria', 'cies-ria']) {
      for (const dir of dirs) {
        const text = await sentText(spot, dir);
        expect(text, `${spot} ${dir}`).not.toMatch(/oleaje|mar de fondo|revuelta|ideal|protegida/i);
      }
    }
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

describe('alertDispatcher — the storm reaching a spot gets through the PELIGRO cooldown (6-oct)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 6, 10, 27));
    resetCooldowns();
    vi.spyOn(log, 'info').mockImplementation(() => {});
    vi.spyOn(log, 'ok').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const texts = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.map((c) => (JSON.parse(String((c[1] as RequestInit).body)) as { text: string }).text);

  it('Castrelo: PELIGRO at 10 km, then a strike within 1 km 29 min later is sent as RAYOS ENCIMA, once', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    await dispatchLightningAlert('Embalse', 'peligro', ['Castrelo: rayo a 10km (10 en 20min)'], 10);
    vi.setSystemTime(new Date(2026, 9, 6, 10, 40));
    await dispatchLightningAlert('Embalse', 'peligro', ['Castrelo: rayo a 6km (30 en 20min)'], 6);
    expect(fetch).toHaveBeenCalledTimes(1);                     // still inside the cooldown, not on the spot
    vi.setSystemTime(new Date(2026, 9, 6, 10, 56));
    await dispatchLightningAlert('Embalse', 'peligro', ['Castrelo: rayo a <1km (80 en 20min)'], 0.9);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(texts(fetch)[1]).toContain('RAYOS ENCIMA');
    vi.setSystemTime(new Date(2026, 9, 6, 11, 1));
    await dispatchLightningAlert('Embalse', 'peligro', ['Castrelo: rayo a <1km (118 en 20min)'], 0.5);
    expect(fetch).toHaveBeenCalledTimes(2);                     // already said it is overhead
  });

  it('after a restart (stored PELIGRO without distance) the storm overhead is still announced', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    seedCooldowns([{ key: 'lightning:Embalse', atMs: Date.now() - 10 * 60_000, level: 'peligro' }]);
    await dispatchLightningAlert('Embalse', 'peligro', ['Castrelo: rayo a 7km'], 7);
    expect(fetch).not.toHaveBeenCalled();
    await dispatchLightningAlert('Embalse', 'peligro', ['Castrelo: rayo a 2km'], 2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('alertDispatcher — fire watch: one message per storm, not one per zone (30-sep)', () => {
  const zones = [
    { lat: 42.34, lon: -7.86, strikeCount: 3, maxAbsKa: 12, near: 'Ribadavia' },
    { lat: 43.09, lon: -6.84, strikeCount: 2, maxAbsKa: 11 },
  ];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 5, 20, 0)); // 20:00 local, outside the night silence
    resetCooldowns();
    vi.spyOn(log, 'info').mockImplementation(() => {});
    vi.spyOn(log, 'ok').mockImplementation(() => {});
  });
  afterEach(() => {
    setSendRecorder(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('several zones go out in ONE message, stored under every zone key', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const stored: SentRecord[] = [];
    setSendRecorder(async (r) => { stored.push(r); });
    expect(await dispatchFireWatchDigest(zones)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(stored[0].key).toBe('fire:42.34,-7.86;43.09,-6.84');
    expect(stored[0].message).toContain('en 2 zonas');
    expect(fireWatchAlertedZones().map((z) => [z.lat, z.lon])).toEqual([[42.34, -7.86], [43.09, -6.84]]);
  });

  it('at most one message an hour: new zones wait for the next one', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    await dispatchFireWatchDigest([zones[0]]);
    vi.setSystemTime(new Date(2026, 8, 5, 20, 30));
    expect(await dispatchFireWatchDigest([zones[1]])).toBe(false);
    vi.setSystemTime(new Date(2026, 8, 5, 21, 0));
    expect(await dispatchFireWatchDigest([zones[1]])).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('nothing at night; nothing is marked as announced when the send fails', async () => {
    vi.setSystemTime(new Date(2026, 8, 6, 2, 0));
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(await dispatchFireWatchDigest(zones)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(2026, 8, 6, 7, 30));
    expect(await dispatchFireWatchDigest(zones)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fireWatchAlertedZones()).toEqual([]);
  });

  it('after a restart every zone of a stored message is remembered, and the old one-zone keys too', () => {
    const now = Date.now();
    expect(seedCooldowns([
      { key: 'fire:42.34,-7.86;43.09,-6.84', atMs: now - 60 * 60_000, level: 'moderate' },
      { key: 'fire:42.4,-7.6', atMs: now - 2 * 60 * 60_000, level: 'moderate' },
    ])).toBe(3);
    expect(fireWatchAlertedZones()).toHaveLength(3);
  });
});
