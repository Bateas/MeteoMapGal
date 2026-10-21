import { describe, it, expect } from 'vitest';
import { aemetFromRows } from './aemetFromApi';
import type { HistoryReading } from './historyClient';
import type { NormalizedStation } from '../types/station';

const row = (id: string, extra: Partial<HistoryReading> = {}): HistoryReading => ({
  time: '2026-10-21T10:00:00+00', station_id: id, source: 'aemet',
  temperature: 15, humidity: 80, wind_speed: 3, wind_gust: 5, wind_dir: 250,
  pressure: 1012, dew_point: 11, precip: 0, solar_rad: null, ...extra,
});
const st = (id: string, name: string): NormalizedStation => ({ id, source: 'aemet', name, lat: 43, lon: -8.4, altitude: 50 });

describe('aemetFromRows', () => {
  it('keeps only the sector stations as readings', () => {
    const out = aemetFromRows([row('aemet_1484C'), row('aemet_1690A')], null, new Set(['aemet_1484C']));
    expect(out.readings.map((r) => r.stationId)).toEqual(['aemet_1484C']);
  });

  it('takes visibility from the regional stations, outside the sector too, with their position', () => {
    const out = aemetFromRows(
      [row('aemet_1400', { visibility: 0.4 }), row('aemet_1484C', { visibility: 12 }), row('aemet_9999', { visibility: 1 })],
      [st('aemet_1400', 'Fisterra'), st('aemet_1484C', 'Pontevedra')],
      new Set(['aemet_1484C']),
    );
    expect(out.visibility.map((v) => [v.stationId, v.name, v.visibility])).toEqual([
      ['aemet_1400', 'Fisterra', 0.4], ['aemet_1484C', 'Pontevedra', 12],
    ]);
    expect(out.readings[0].visibility).toBe(12);
  });

  it('drops visibility it cannot place or that is out of range', () => {
    const out = aemetFromRows([row('aemet_1351', { visibility: 2 }), row('aemet_1428', { visibility: 80 })], [st('aemet_1428', 'Santiago')], new Set());
    expect(out.visibility).toEqual([]);
  });
});
