import { describe, it, expect } from 'vitest';
import { metarRows } from './metarRows';

// Real entries from aviationweather.gov (1-oct-2026), trimmed to the fields the API sends.
const LEVX_CAVOK = {
  icaoId: 'LEVX', obsTime: 1790816400, temp: 12, dewp: 11, wdir: 340, wspd: 2, visib: '6+', altim: 1025,
  rawOb: 'METAR LEVX 010100Z AUTO 34002KT CAVOK 12/11 Q1025', cover: 'CAVOK', clouds: [],
};
const LEST_VRB = {
  icaoId: 'LEST', obsTime: 1790812800, temp: 11, dewp: 10, wdir: 'VRB', wspd: 2, visib: '6+', altim: 1025,
  rawOb: 'METAR LEST 010000Z VRB02KT 9999 FEW024 11/10 Q1025 NOSIG', cover: 'FEW', clouds: [{ cover: 'FEW', base: 2400 }],
};

describe('metarRows — the METAR archive', () => {
  it('keeps the whole report: time in seconds, visibility capped at 10 km, raw text', () => {
    const [r] = metarRows([LEVX_CAVOK]);
    expect(r.icao).toBe('LEVX');
    expect(r.obsTime.toISOString()).toBe('2026-10-01T01:00:00.000Z');
    expect(r.visibilityKm).toBe(10);
    expect(r.wx).toBeNull();
    expect([r.tempC, r.dewpointC, r.windDir, r.windKt, r.pressureHpa]).toEqual([12, 11, 340, 2, 1025]);
    expect(r.cover).toBe('CAVOK');
    expect(r.clouds).toBeNull();
    expect(r.rawOb).toContain('CAVOK');
  });

  it('variable wind has no direction, and cloud layers read as in the report', () => {
    const [r] = metarRows([LEST_VRB]);
    expect(r.windDir).toBeNull();
    expect(r.windKt).toBe(2);
    expect(r.clouds).toBe('FEW024');
  });

  it('fog is kept with its visibility and its present-weather group', () => {
    const fog = { ...LEVX_CAVOK, visib: 0.25, wxString: 'FG', cover: 'VV', rawOb: 'METAR LEVX 290700Z AUTO 00000KT 0400 FG VV001 11/11 Q1020' };
    const [r] = metarRows([fog]);
    expect(r.wx).toBe('FG');
    expect(r.visibilityKm).toBe(0.4);
  });

  it('drops only what cannot be placed: no station, no time or no raw text', () => {
    expect(metarRows([{ ...LEVX_CAVOK, icaoId: '' }, { ...LEVX_CAVOK, obsTime: undefined }, { ...LEVX_CAVOK, rawOb: '' }])).toEqual([]);
    expect(metarRows(null)).toEqual([]);
  });
});
