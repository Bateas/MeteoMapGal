/**
 * Tests for the daily-summary builders (pure functions).
 * Focus: forecast-driven day outlook, spot-favouring by primary windPattern,
 * the inland-reservoir marine-obs bug fix, and the no-regional-averages cut.
 */
import { describe, it, expect } from 'vitest';
import {
  summarizeDayOutlook, spotsFavoredByDir, formatOutlook,
  buildSectorBlock, buildMessage,
} from './dailySummary';
import type { HourlyForecast } from '../src/types/forecast';

const NOW = new Date('2026-06-01T09:00:00'); // lunes 1 de junio, 09:00

function fcHour(hour: number, windMs: number, windDir: number): HourlyForecast {
  const t = new Date('2026-06-01T00:00:00');
  t.setHours(hour, 0, 0, 0);
  return {
    time: t, temperature: 22, humidity: 60, windSpeed: windMs, windDirection: windDir,
    windGusts: windMs * 1.3, precipitation: 0, precipProbability: 0, cloudCover: 30,
    pressure: 1018, solarRadiation: 500, cape: null, boundaryLayerHeight: null,
    visibility: null, liftedIndex: null, cin: null, snowLevel: null, skyState: null, isDay: true,
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

// SectorSummary shape (interface internal — build structurally).
function sector(over: Partial<Parameters<typeof buildSectorBlock>[0]> = {}) {
  return {
    name: 'Rías Baixas', coastal: true, stationCount: 100,
    outlook: null, favoredSpots: [], maxWaveHeight: null, maxWaveStation: '', waterTemp: null,
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
