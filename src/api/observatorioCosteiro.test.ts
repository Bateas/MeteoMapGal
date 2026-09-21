import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseObsReading } from './observatorioCosteiro';
import fixture from './observatorioCosteiro.fixture.json';

// Same real payloads as the ingestor test (2026-09-21, about 23:00 UTC).
type Payload = Parameters<typeof parseObsReading>[1];
const payload = (id: keyof typeof fixture): Payload => fixture[id] as unknown as Payload;

const station = (obsId: number, canonicalId: number, name: string) =>
  ({ obsId, canonicalId, name, lat: 0, lon: 0 });

describe('parseObsReading — 10-minute readings only', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('Cortegada and A Guarda: the wind is the 10-minute value, not an hourly or daily mean', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T23:00:00Z'));
    const c = parseObsReading(station(15001, 1250, 'Cortegada (Arousa)'), payload('15001'))!;
    expect([c.windSpeed, c.windDir, c.airTemp, c.humidity]).toEqual([3.83, 60, 21.01, 55]);
    const g = parseObsReading(station(15004, 1253, 'A Guarda'), payload('15004'))!;
    expect([g.windSpeed, g.windDir, g.humidity, g.dewPoint]).toEqual([1.38, 83, 50, 10.45]);
  });

  it('Muros: fields behind a monthly -9999 are read', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T23:00:00Z'));
    const m = parseObsReading(station(15009, 15009, 'Muros'), payload('15009'))!;
    expect([m.windSpeed, m.windDir, m.airTemp, m.waterTemp, m.salinity]).toEqual([1.86, 34, 19.88, 17.434, 35.233]);
  });

  it('Rande: surface water sensor and salinity; stale a day later', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T19:50:00Z'));
    const r = parseObsReading(station(15100, 1251, 'Rande (Ría Vigo)'), payload('15100'))!;
    expect([r.waterTemp, r.salinity, r.windSpeed]).toEqual([17.455, 35.325, null]);
    vi.setSystemTime(new Date('2026-09-21T23:00:00Z'));
    expect(parseObsReading(station(15100, 1251, 'Rande (Ría Vigo)'), payload('15100'))).toBeNull();
  });
});
