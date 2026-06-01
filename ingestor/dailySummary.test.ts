/**
 * Tests for the daily-summary message builder (pure functions).
 * Focus: per-spot rendering, the two bug fixes (no marine obs in the inland
 * reservoir sector; no regional temp/humidity averages), and boost notes.
 */
import { describe, it, expect } from 'vitest';
import { buildSectorBlock, buildMessage } from './dailySummary';

// SectorSummary shape (interface is internal — build structurally).
function sector(over: Partial<Parameters<typeof buildSectorBlock>[0]> = {}) {
  return {
    name: 'Rías Baixas',
    coastal: true,
    stationCount: 100,
    spots: [],
    maxWaveHeight: null,
    maxWaveStation: '',
    waterTemp: null,
    ...over,
  } as Parameters<typeof buildSectorBlock>[0];
}

const spot = (shortName: string, verdict: string, windKt: number, dir: string, boostedBy: string | null = null) =>
  ({ shortName, verdict, windKt, dir, boostedBy });

describe('buildSectorBlock', () => {
  it('renders sailable spots with emoji, label, wind and boost note', () => {
    const block = buildSectorBlock(sector({
      spots: [spot('Cesantes', 'good', 14, 'SW', 'cesantes-canalization')],
      maxWaveHeight: 1.2, maxWaveStation: 'Cabo Silleiro', waterTemp: 17,
    }));
    expect(block).toMatch(/Cesantes bueno 14kt SW/);
    expect(block).toMatch(/canalización/);
    expect(block).toMatch(/Olas 1\.2m \(Cabo Silleiro\)/);
    expect(block).toMatch(/Agua 17°/);
  });

  it('says "sin condiciones" when no spot is sailable', () => {
    const block = buildSectorBlock(sector({ waterTemp: 16 }));
    expect(block).toMatch(/Sin condiciones de vela ahora/);
    expect(block).toMatch(/Agua 16°/); // marine obs still shown for coastal
  });

  it('NEVER shows marine obs for the inland reservoir (bug fix)', () => {
    const block = buildSectorBlock(sector({
      name: 'Embalse de Castrelo', coastal: false,
      spots: [spot('Castrelo', 'sailing', 12, 'SW')],
      maxWaveHeight: 0.2, maxWaveStation: 'Vigo', waterTemp: 16, // would have leaked before
    }));
    expect(block).toMatch(/Castrelo navegable 12kt SW/);
    expect(block).not.toMatch(/Olas/);
    expect(block).not.toMatch(/Agua/);
  });

  it('renders multiple spots in the order given (best-first done by the query)', () => {
    const block = buildSectorBlock(sector({
      spots: [spot('Cesantes', 'good', 16, 'SW'), spot('Lourido', 'sailing', 10, 'SW')],
    }));
    expect(block.indexOf('Cesantes')).toBeLessThan(block.indexOf('Lourido'));
  });
});

describe('buildMessage', () => {
  const NOW = new Date('2026-06-01T09:05:00'); // lunes 1 de junio

  it('has the header date, both sectors, and the footer', () => {
    const msg = buildMessage([
      sector({ spots: [spot('Cesantes', 'good', 14, 'SW')] }),
      sector({ name: 'Embalse de Castrelo', coastal: false, spots: [] }),
    ], NOW);
    expect(msg).toMatch(/Resumen diario MeteoMapGal/);
    expect(msg).toMatch(/lunes 1 de junio/);
    expect(msg).toMatch(/Rías Baixas/);
    expect(msg).toMatch(/Embalse de Castrelo/);
    expect(msg).toMatch(/meteomapgal\.navia3d\.com/);
  });

  it('does NOT emit regional averages (temp range / humidity) — the noise cut', () => {
    const msg = buildMessage([sector({ spots: [spot('Cesantes', 'good', 14, 'SW')] })], NOW);
    expect(msg).not.toMatch(/Temp:/);
    expect(msg).not.toMatch(/Humedad:/);
    expect(msg).not.toMatch(/-?\d+° - \d/); // the old "-35° - 22.6°C" pattern
  });

  it('skips null sectors gracefully', () => {
    const msg = buildMessage([null, sector({ spots: [] })], NOW);
    expect(msg).toMatch(/Rías Baixas/);
  });
});
