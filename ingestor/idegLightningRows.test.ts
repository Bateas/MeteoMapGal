import { describe, it, expect } from 'vitest';
import { idegLightningRows, idegHasMore } from './idegLightningRows';

// Shape of a real response (8-oct-2026, layer 1 of Observacion_raios_ultimas_24h, outSR=4326).
const payload = {
  features: [
    { attributes: { idDescargas: 101, Fecha: 1791337906000, PeakCurrent: -14, CloudInd: 0, Multiplicidad: 1, Nsensores: 2, SemiEjeMayor: 12.1, SemiEjeMenor: 3.4, ChiSquare: 1.2 }, geometry: { x: -6.622, y: 43.778 } },
    { attributes: { idDescargas: 102, Fecha: 1791337910000, PeakCurrent: null, CloudInd: 1, Multiplicidad: null, Nsensores: 4, SemiEjeMayor: 1.1, SemiEjeMenor: 0.6, ChiSquare: 0.9 }, geometry: { x: -8.1, y: 42.3 } },
    { attributes: { idDescargas: 103, Fecha: null, CloudInd: 0 }, geometry: { x: -8.1, y: 42.3 } },
    { attributes: { idDescargas: 104, Fecha: 1791337920000, CloudInd: 0 }, geometry: {} },
  ],
  exceededTransferLimit: true,
};

describe('idegLightningRows', () => {
  it('keeps time, position, polarity, intra-cloud flag and location quality', () => {
    const rows = idegLightningRows(payload);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ lat: 43.778, lon: -6.622, peakCurrent: -14, intraCloud: false, sensors: 2, semiMajor: 12.1, sourceId: 101 });
    expect(rows[0].time.toISOString()).toBe('2026-10-07T01:51:46.000Z');
    expect(rows[1]).toMatchObject({ intraCloud: true, peakCurrent: null, multiplicity: null, sensors: 4 });
  });

  it('drops what has no time or no position, and reads the paging flag', () => {
    expect(idegLightningRows(payload).map((r) => r.sourceId)).toEqual([101, 102]);
    expect(idegHasMore(payload)).toBe(true);
    expect(idegHasMore({ features: [] })).toBe(false);
  });

  it('an error or an odd body is no rows, never a throw', () => {
    expect(idegLightningRows({ error: { code: 400 } })).toEqual([]);
    expect(idegLightningRows(null)).toEqual([]);
    expect(idegLightningRows('x')).toEqual([]);
  });
});
