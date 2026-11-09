import { describe, it, expect } from 'vitest';
import { getWarningsForSector, type MGWarning, type MGWarningZone } from './mgWarningsClient';

const zone = (name: string, id: number, endsInH = 6, level = 1): MGWarningZone => ({
  name, id, level, startTime: new Date(), endTime: new Date(Date.now() + endsInH * 3_600_000), comment: '',
});
const warning = (zones: MGWarningZone[]): MGWarning => ({
  type: 'Precipitación 12 horas', typeId: 1, maxLevel: 3, zones, publishedAt: new Date(), link: '',
});

// The names and ids of the live feed on 9-nov-2026.
const FEED = warning([
  zone('Pontevedra (provincia)', 319), zone('Oeste de A Coruña', 322), zone('Suroeste de A Coruña', 324),
  zone('Noroeste de Ourense', 329), zone('Sur de Ourense', 331), zone('Montaña de Ourense', 332),
  zone('Litoral Pontevedra', 334), zone('Interior de Pontevedra', 335), zone('Miño de Pontevedra', 336),
  zone('Rías Baixas (mar)', 400), zone('Costa da Morte (mar)', 401),
]);
const names = (sector: 'embalse' | 'rias') => getWarningsForSector([FEED], sector)[0].zones.map((z) => z.name).sort();

describe('getWarningsForSector', () => {
  it('Embalse gets Ourense and its west, not the coast nor A Coruña', () => {
    expect(names('embalse')).toEqual(['Interior de Pontevedra', 'Miño de Pontevedra', 'Noroeste de Ourense', 'Sur de Ourense']);
  });

  it('Rías gets its coast and sea, not the inland Miño', () => {
    expect(names('rias')).toEqual(['Litoral Pontevedra', 'Pontevedra (provincia)', 'Rías Baixas (mar)', 'Suroeste de A Coruña']);
  });

  it('ignores case and stray spaces in the name', () => {
    expect(getWarningsForSector([warning([zone(' NOROESTE DE OURENSE ', 1)])], 'embalse')).toHaveLength(1);
  });

  it('takes the level of the zones that apply, not of the whole warning', () => {
    const w = warning([zone('Sur de Ourense', 331, 6, 1), zone('Litoral Pontevedra', 334, 6, 3)]);
    expect(getWarningsForSector([w], 'embalse')[0].maxLevel).toBe(1);
    expect(getWarningsForSector([w], 'rias')[0].maxLevel).toBe(3);
  });

  it('drops a zone that has ended and a warning left with none', () => {
    expect(getWarningsForSector([warning([zone('Sur de Ourense', 331, -1)])], 'embalse')).toEqual([]);
  });

  it('drops a warning for zones that are not the sector', () => {
    expect(getWarningsForSector([warning([zone('Oeste de A Coruña', 322)])], 'embalse')).toEqual([]);
  });
});
