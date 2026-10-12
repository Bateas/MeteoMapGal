import { describe, it, expect } from 'vitest';
import { summarizeFogBySite, camerasForSector } from './webcamFogSites';
import { webcamSite, isSeaFogCamera, ALL_WEBCAMS } from '../config/webcams';
import { SECTORS } from '../config/sectors';

describe('summarizeFogBySite', () => {
  it('counts two cameras on the same mast that both see fog as ONE site', () => {
    const s = summarizeFogBySite([
      { id: 'mg-ciesfaro-sur', fog: true },
      { id: 'mg-ciesfaro-norte', fog: true, critical: true },
    ], webcamSite);
    expect(s.fogSites).toBe(1);
    expect(s.criticalSites).toBe(1);
    expect(s.clearSites).toBe(0);
    expect(s.fogCameraIds).toEqual(['mg-ciesfaro-sur']);
    expect(s.sites.get('cies-faro')).toBe('fog');
  });

  it('drops the fog camera when its mast sibling sees clear (11-oct, misted Ons Praia)', () => {
    const s = summarizeFogBySite([
      { id: 'mg-ons-praia', fog: true, critical: true },
      { id: 'mg-ons-porto', fog: false },
    ], webcamSite);
    expect(s.fogSites).toBe(0);
    expect(s.criticalSites).toBe(0);
    expect(s.clearSites).toBe(1);
    expect(s.fogCameraIds).toEqual([]);
    expect(s.mixedSites).toEqual(['ons']);
    expect(s.sites.get('ons')).toBe('mixed');
  });

  it('keeps cameras on different sites as independent evidence', () => {
    const s = summarizeFogBySite([
      { id: 'mg-ciesfaro-norte', fog: true },
      { id: 'mg-cangas', fog: true },
      { id: 'mg-aguete', fog: false },
    ], webcamSite);
    expect(s.fogSites).toBe(2);
    expect(s.clearSites).toBe(1);
    expect(s.fogCameraIds).toEqual(['mg-ciesfaro-norte', 'mg-cangas']);
  });

  it('a lone camera on its mast still counts (the sibling has no fresh image)', () => {
    const s = summarizeFogBySite([{ id: 'mg-ons-praia', fog: true }], webcamSite);
    expect(s.fogSites).toBe(1);
    expect(s.fogCameraIds).toEqual(['mg-ons-praia']);
  });

  it('critical only counts on a fog site', () => {
    const s = summarizeFogBySite([{ id: 'mg-cangas', fog: false, critical: true }], webcamSite);
    expect(s.criticalSites).toBe(0);
    expect(s.clearSites).toBe(1);
  });

  it('nothing in, nothing out', () => {
    const s = summarizeFogBySite([], webcamSite);
    expect(s.fogSites + s.clearSites + s.criticalSites).toBe(0);
    expect(s.sites.size).toBe(0);
  });
});

describe('webcamSite', () => {
  it('maps the same-mast pairs to one site and the rest to themselves', () => {
    expect(webcamSite('mg-ciesfaro-sur')).toBe(webcamSite('mg-ciesfaro-norte'));
    expect(webcamSite('mg-ons-praia')).toBe(webcamSite('mg-ons-porto'));
    expect(webcamSite('mg-ciesrodas')).toBe('mg-ciesrodas');
    expect(webcamSite('desconocida')).toBe('desconocida');
  });
});

describe('isSeaFogCamera', () => {
  it('a camera known to stand high up does not speak for fog on the water (Castrove, 515 m, 11-oct)', () => {
    expect(isSeaFogCamera('mg-castrove')).toBe(false);
  });
  it('nor one whose glass mists over (Ons Praia: fog in 12.4 % of its verdicts, 77 % alone)', () => {
    expect(isSeaFogCamera('mg-ons-praia')).toBe(false);
    expect(isSeaFogCamera('mg-ons-porto')).toBe(true);
  });
  it('cameras at sea level, and those whose altitude is not known, do', () => {
    expect(isSeaFogCamera('mg-cangas')).toBe(true);
    expect(isSeaFogCamera('mg-ciesfaro-norte')).toBe(true);
    expect(isSeaFogCamera('desconocida')).toBe(true);
  });
});

describe('camerasForSector', () => {
  const ids = (sectorId: string) => {
    const s = SECTORS.find((x) => x.id === sectorId)!;
    return [...camerasForSector(ALL_WEBCAMS, sectorId, s.center[1], s.center[0], s.radiusKm * 1.5).keys()];
  };
  it('the Embalse counts its road cameras, never a Rias camera', () => {
    expect(ids('embalse').sort()).toEqual(['dgt-barbantes', 'dgt-ribadavia']);
  });
  it('the Rias count their cameras, not the A Coruna ones nor the Ribadavia road camera', () => {
    const r = ids('rias');
    expect(r).toContain('mg-ciesfaro-norte');
    expect(r).toContain('mg-corrubedo');
    expect(r).not.toContain('mg-corunha');
    expect(r).not.toContain('mg-langosteira');
    expect(r).not.toContain('dgt-ribadavia');
  });
});
