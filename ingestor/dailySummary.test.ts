/**
 * Tests for the daily-summary builders (pure functions).
 * Focus: forecast-driven day outlook, spot-favouring by primary windPattern,
 * the inland-reservoir marine-obs bug fix, and the no-regional-averages cut.
 */
import { describe, it, expect, vi } from 'vitest';
import { log } from './logger';
import { checkAndSendDailySummary, seedDailySummary,
  summarizeDayOutlook, spotsFavoredByDir, formatOutlook,
  summarizeDayHazard, formatHazard,
  buildSectorBlock, buildMessage, withSynopticRegime,
} from './dailySummary';
import type { HourlyForecast } from '../src/types/forecast';

const NOW = new Date('2026-06-01T09:00:00'); // lunes 1 de junio, 09:00

function fcHour(hour: number, windMs: number, windDir: number, extra: Partial<HourlyForecast> = {}): HourlyForecast {
  const t = new Date('2026-06-01T00:00:00');
  t.setHours(hour, 0, 0, 0);
  return {
    time: t, temperature: 22, humidity: 60, windSpeed: windMs, windDirection: windDir,
    windGusts: windMs * 1.3, precipitation: 0, precipProbability: 0, cloudCover: 30,
    pressure: 1018, solarRadiation: 500, cape: null, boundaryLayerHeight: null,
    visibility: null, liftedIndex: null, cin: null, snowLevel: null, skyState: null, isDay: true,
    ...extra,
  };
}
const ms = (kt: number) => kt / 1.944;

describe('summarizeDayOutlook', () => {
  it('returns null when it stays light all day', () => {
    const hours = [12, 14, 16, 18].map((h) => fcHour(h, ms(4), 225)); // 4kt < 8
    expect(summarizeDayOutlook(hours, NOW)).toBeNull();
  });

  it('captures an afternoon SW thermal window', () => {
    const hours = [14, 15, 16, 17, 18, 19].map((h) => fcHour(h, ms(13), 225));
    const o = summarizeDayOutlook(hours, NOW)!;
    expect(o.startHour).toBe(14);
    expect(o.endHour).toBe(19);
    expect(o.peakKt).toBe(13);
    expect(o.dir).toBe('SW');
    expect(o.pattern).toBe('térmico');
    expect(o.strong).toBe(false);
  });

  it('flags strong nortada', () => {
    const hours = [12, 14, 16, 18, 20].map((h) => fcHour(h, ms(28), 350));
    const o = summarizeDayOutlook(hours, NOW)!;
    expect(o.strong).toBe(true);
    expect(o.pattern).toBe('nortada');
    expect(o.dir).toBe('N');
  });

  it('ignores past hours and other days', () => {
    const hours = [
      fcHour(5, ms(20), 225),  // before DAY_START / past
      { ...fcHour(16, ms(13), 225), time: new Date('2026-06-02T16:00:00') }, // tomorrow
    ];
    expect(summarizeDayOutlook(hours, NOW)).toBeNull();
  });
});

describe('spotsFavoredByDir', () => {
  it('SW favours SW spots (Cesantes/Lourido) but NOT Liméns (primary N)', () => {
    const favored = spotsFavoredByDir('rias', 225);
    expect(favored).toContain('Cesantes');
    expect(favored).toContain('Lourido');
    expect(favored).not.toContain('Liméns');
  });

  it('N favours Liméns (primary N) but not the SW thermal spots', () => {
    const favored = spotsFavoredByDir('rias', 340);
    expect(favored).toContain('Liméns');
    expect(favored).not.toContain('Cesantes');
  });

  it('never lists surf spots', () => {
    const all = [...spotsFavoredByDir('rias', 225), ...spotsFavoredByDir('rias', 340)];
    expect(all.some((n) => /surf/i.test(n))).toBe(false);
  });

  it('returns empty for unknown direction', () => {
    expect(spotsFavoredByDir('rias', -1)).toEqual([]);
  });
});

describe('formatOutlook', () => {
  it('light day', () => {
    expect(formatOutlook(null)).toMatch(/Flojo hoy/);
  });
  it('normal sailable window', () => {
    const s = formatOutlook({ startHour: 14, endHour: 19, peakKt: 14, dirDeg: 225, dir: 'SW', pattern: 'térmico', strong: false });
    expect(s).toMatch(/Navegable 14-19h · hasta 14kt SW \(térmico\)/);
  });
  it('strong wind warning', () => {
    const s = formatOutlook({ startHour: 11, endHour: 21, peakKt: 28, dirDeg: 350, dir: 'N', pattern: 'nortada', strong: true });
    expect(s).toMatch(/⚠️ Viento fuerte/);
    expect(s).toMatch(/28kt N \(nortada\)/);
  });
});

describe('summarizeDayHazard', () => {
  it('clear day → no rain, no storm', () => {
    const h = summarizeDayHazard([14, 16, 18].map((hr) => fcHour(hr, ms(10), 225)), NOW);
    expect(h.rain).toBeNull();
    expect(h.storm).toBe(false);
  });

  it('flags the most-probable wet hour', () => {
    const h = summarizeDayHazard([
      fcHour(14, ms(8), 225, { precipProbability: 40, precipitation: 0.5 }), // below RAIN_PROB
      fcHour(16, ms(8), 225, { precipProbability: 70, precipitation: 1.2 }),
      fcHour(18, ms(8), 225, { precipProbability: 60, precipitation: 0.8 }),
    ], NOW);
    expect(h.rain).toEqual({ hour: 16, prob: 70 });
  });

  it('ignores high-probability with only a trace of rain', () => {
    const h = summarizeDayHazard([fcHour(16, ms(8), 225, { precipProbability: 80, precipitation: 0.1 })], NOW);
    expect(h.rain).toBeNull();
  });

  it('flags storm risk only when uncapped (CAPE high + LI negative + low CIN)', () => {
    const risky = summarizeDayHazard([fcHour(17, ms(8), 225, { cape: 1500, liftedIndex: -4, cin: 30 })], NOW);
    expect(risky.storm).toBe(true);
    const capped = summarizeDayHazard([fcHour(17, ms(8), 225, { cape: 1500, liftedIndex: -4, cin: 400 })], NOW);
    expect(capped.storm).toBe(false); // CIN caps it
  });
});

describe('formatHazard', () => {
  it('empty when clear', () => {
    expect(formatHazard({ rain: null, storm: false })).toBe('');
  });
  it('renders storm + rain lines', () => {
    const s = formatHazard({ rain: { hour: 16, prob: 70 }, storm: true });
    expect(s).toMatch(/⛈️ Riesgo de tormenta/);
    expect(s).toMatch(/🌧️ Lluvia ~16h \(70%\)/);
  });
});

// SectorSummary shape (interface internal — build structurally).
function sector(over: Partial<Parameters<typeof buildSectorBlock>[0]> = {}) {
  return {
    name: 'Rías Baixas', coastal: true, stationCount: 100,
    outlook: null, favoredSpots: [], hazard: { rain: null, storm: false },
    maxWaveHeight: null, maxWaveStation: '', waterTemp: null,
    ...over,
  } as Parameters<typeof buildSectorBlock>[0];
}

describe('buildSectorBlock', () => {
  it('renders outlook + favoured spots + marine obs (coastal)', () => {
    const block = buildSectorBlock(sector({
      outlook: { startHour: 14, endHour: 19, peakKt: 14, dirDeg: 225, dir: 'SW', pattern: 'térmico', strong: false },
      favoredSpots: ['Cesantes', 'Lourido'],
      maxWaveHeight: 1.2, maxWaveStation: 'Cabo Silleiro', waterTemp: 17,
    }));
    expect(block).toMatch(/Navegable 14-19h/);
    expect(block).toMatch(/Cesantes · Lourido/);
    expect(block).toMatch(/Olas 1\.2m \(Cabo Silleiro\)/);
    expect(block).toMatch(/Agua 17°/);
  });

  it('NEVER shows marine obs for the inland reservoir (bug fix)', () => {
    const block = buildSectorBlock(sector({
      name: 'Embalse de Castrelo', coastal: false,
      outlook: { startHour: 14, endHour: 18, peakKt: 12, dirDeg: 225, dir: 'SW', pattern: 'térmico', strong: false },
      maxWaveHeight: 0.2, maxWaveStation: 'Vigo', waterTemp: 16, // would have leaked before
    }));
    expect(block).toMatch(/Navegable 14-18h/);
    expect(block).not.toMatch(/Olas/);
    expect(block).not.toMatch(/Agua/);
  });

  it('light day → no favoured-spots line', () => {
    const block = buildSectorBlock(sector({ outlook: null, favoredSpots: [], waterTemp: 16 }));
    expect(block).toMatch(/Flojo hoy/);
    expect(block).not.toMatch(/🏄/);
    expect(block).toMatch(/Agua 16°/);
  });
});

describe('buildMessage', () => {
  it('header date + sectors + footer, and NO regional averages', () => {
    const msg = buildMessage([
      sector({ outlook: { startHour: 14, endHour: 19, peakKt: 14, dirDeg: 225, dir: 'SW', pattern: 'térmico', strong: false }, favoredSpots: ['Cesantes'] }),
      sector({ name: 'Embalse de Castrelo', coastal: false }),
    ], NOW);
    expect(msg).toMatch(/Resumen diario MeteoMapGal/);
    expect(msg).toMatch(/lunes 1 de junio/);
    expect(msg).toMatch(/Rías Baixas/);
    expect(msg).toMatch(/Embalse de Castrelo/);
    expect(msg).not.toMatch(/Temp:/);
    expect(msg).not.toMatch(/Humedad:/);
  });
});

describe('daily summary — a restart between 9 and 10 does not send it twice (29-sep)', () => {
  it('skips the summary when today\'s was already sent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 9, 30));
    const info = vi.spyOn(log, 'info').mockImplementation(() => {});
    seedDailySummary([{ key: 'summary:daily', atMs: new Date(2026, 8, 29, 9, 4).getTime(), level: '' }], new Date());
    await checkAndSendDailySummary();
    expect(info).not.toHaveBeenCalledWith('Generating daily summary...');
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
});

describe('withSynopticRegime — a SW under the frontal flow aloft is not a breeze (30-sep)', () => {
  const day = new Date('2026-09-30T09:00:00');
  // The outlook the summary sent on 30-sep for the Rías: 13-16 h, up to 11 kt WSW.
  const outlook = { startHour: 13, endHour: 16, peakKt: 11, dirDeg: 245, dir: 'WSW', pattern: 'térmico' as const, strong: false };
  const level = (hour: number, kt: number, dir: number) => {
    const t = new Date(day);
    t.setHours(hour, 0, 0, 0);
    return { time: t, pressureHpa: 850, windSpeedMs: kt / 1.94384, windDirDeg: dir };
  };
  // 850 hPa stored that morning for the Rías, 13-16 h.
  const frontal = [level(13, 23, 237), level(14, 21, 242), level(15, 21, 242), level(16, 20, 250)];

  it('30-sep: SW 20-23 kt at 1.500 m all window long -> "de frente", and the summary no longer says térmico', () => {
    const o = withSynopticRegime(outlook, frontal, day);
    expect(o.pattern).toBe('de frente');
    expect(formatOutlook(o)).toBe('Navegable 13-16h · hasta 11kt WSW (de frente)');
  });

  it('light NW aloft (the breeze afternoons: 6-ago, 25-sep) keeps "térmico"', () => {
    const breeze = [13, 14, 15, 16].map((h) => level(h, 6, 320));
    expect(withSynopticRegime(outlook, breeze, day).pattern).toBe('térmico');
  });

  it('frontal in half the window is enough; in less than half it is not', () => {
    const half = [level(13, 23, 237), level(14, 21, 242), level(15, 6, 320), level(16, 6, 320)];
    expect(withSynopticRegime(outlook, half, day).pattern).toBe('de frente');
    const one = [level(13, 23, 237), level(14, 6, 320), level(15, 6, 320), level(16, 6, 320)];
    expect(withSynopticRegime(outlook, one, day).pattern).toBe('térmico');
  });

  it('without upper-air rows for those hours nothing changes; a nortada is never touched', () => {
    expect(withSynopticRegime(outlook, [], day)).toBe(outlook);
    const nortada = { ...outlook, dirDeg: 340, dir: 'NNW', pattern: 'nortada' as const };
    expect(withSynopticRegime(nortada, frontal, day)).toBe(nortada);
  });
});
