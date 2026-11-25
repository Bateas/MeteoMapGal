import { describe, it, expect } from 'vitest';
import { mgWarningsAt, ipmaWarningsAt, zoneReaches, kmToBorder } from './warningReach';
import type { MGWarning } from '../api/mgWarningsClient';
import type { IpmaWarning } from '../api/ipmaWarningsClient';

// Spot centres as in config/spots.ts.
const CESANTES = { lat: 42.307, lon: -8.619 };
const CORRUBEDO = { lat: 42.556, lon: -9.033 };
const ILLA_AROUSA = { lat: 42.546, lon: -8.860 };
const CASTRELO = { lat: 42.299, lon: -8.109 };
const BELESAR = { lat: 42.630, lon: -7.712 };
const TUI = { lat: 42.047, lon: -8.645 };

const t0 = new Date('2026-11-18T06:00:00Z'), t1 = new Date('2026-11-18T18:00:00Z');
const zone = (name: string, level = 1) => ({ name, id: 1, level, startTime: t0, endTime: t1, comment: '' });
const mg = (type: string, ...zones: ReturnType<typeof zone>[]): MGWarning =>
  ({ type, typeId: 1, maxLevel: Math.max(...zones.map((z) => z.level)), zones, publishedAt: t0, link: '' } as MGWarning);
const ipma: IpmaWarning = {
  id: 'x', districtCode: 'VCT', districtName: 'Viana do Castelo', type: 'Precipitação', level: 1,
  levelName: 'yellow', startTime: t0, endTime: t1, description: '',
};

describe('warningReach', () => {
  it('Cesantes does not hear the IPMA warning for Viana do Castelo (18-nov)', () => {
    expect(kmToBorder(CESANTES)).toBeGreaterThan(15);
    expect(ipmaWarningsAt([ipma], CESANTES)).toEqual([]);
  });

  it('a point on the Miño does', () => {
    expect(ipmaWarningsAt([ipma], TUI)).toHaveLength(1);
  });

  it('without a point everything stays: the map band speaks for the whole sector', () => {
    expect(ipmaWarningsAt([ipma], null)).toHaveLength(1);
    const w = [mg('Vento', zone('Suroeste de A Coruña'))];
    expect(mgWarningsAt(w, undefined)).toBe(w);
  });

  it('the north shore of Arousa is A Coruña; A Illa and Cesantes are Pontevedra', () => {
    expect(zoneReaches('Suroeste de A Coruña', CORRUBEDO)).toBe(true);
    expect(zoneReaches('Suroeste de A Coruña', ILLA_AROUSA)).toBe(false);
    expect(zoneReaches('Suroeste de A Coruña', CESANTES)).toBe(false);
    expect(zoneReaches('Litoral Pontevedra', CESANTES)).toBe(true);
    expect(zoneReaches('Rías Baixas (mar)', CORRUBEDO)).toBe(true);
  });

  it('inland: Belesar is Lugo, Castrelo is Ourense', () => {
    expect(zoneReaches('Sur de Lugo', BELESAR)).toBe(true);
    expect(zoneReaches('Sur de Lugo', CASTRELO)).toBe(false);
    expect(zoneReaches('Sur de Ourense', CASTRELO)).toBe(true);
    expect(zoneReaches('Miño de Pontevedra', CASTRELO)).toBe(false);
  });

  it('keeps only the zones of the spot and recomputes the top level', () => {
    const w = mg('Vento', zone('Suroeste de A Coruña', 2), zone('Litoral Pontevedra', 1));
    const [at] = mgWarningsAt([w], CESANTES);
    expect(at.zones.map((z) => z.name)).toEqual(['Litoral Pontevedra']);
    expect(at.maxLevel).toBe(1);
  });

  it('drops a warning none of whose zones reach the spot', () => {
    expect(mgWarningsAt([mg('Vento', zone('Suroeste de A Coruña', 2))], CESANTES)).toEqual([]);
  });

  it('a zone it does not know stays: one warning too many beats a real one missing', () => {
    expect(zoneReaches('Zona nueva', CESANTES)).toBe(true);
  });
});
