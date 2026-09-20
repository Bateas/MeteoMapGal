import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchIpmaWarnings,
  getIpmaWarningsForSector,
  type IpmaWarning,
} from './ipmaWarningsClient';

describe('ipmaWarningsClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const now = Date.now();
  const future = new Date(now + 2 * 3600_000).toISOString();
  const past = new Date(now - 3600_000).toISOString();

  const mockWarnings = [
    // Border district (VCT), active, orange (level 2)
    {
      idAreaAviso: 'VCT',
      awarenessTypeName: 'Vento',
      awarenessLevelID: 'orange',
      startTime: new Date(now - 1800_000).toISOString(),
      endTime: future,
      text: 'Rajadas até 80 km/h',
    },
    // Border district (BRG), active, yellow (level 1)
    {
      idAreaAviso: 'BRG',
      awarenessTypeName: 'Precipitação',
      awarenessLevelID: 'yellow',
      startTime: new Date(now - 1800_000).toISOString(),
      endTime: future,
      text: 'Chuva forte',
    },
    // Border district (VRL), expired -> should be filtered
    {
      idAreaAviso: 'VRL',
      awarenessTypeName: 'Trovoada',
      awarenessLevelID: 'yellow',
      startTime: new Date(now - 7200_000).toISOString(),
      endTime: past,
      text: 'Trovoada frequente',
    },
    // Green level (no alert) -> should be filtered
    {
      idAreaAviso: 'VCT',
      awarenessTypeName: 'Agitação Marítima',
      awarenessLevelID: 'green',
      startTime: new Date(now - 1800_000).toISOString(),
      endTime: future,
      text: '',
    },
    // Non-border district (LIS) -> should be filtered
    {
      idAreaAviso: 'LIS',
      awarenessTypeName: 'Vento',
      awarenessLevelID: 'red',
      startTime: new Date(now - 1800_000).toISOString(),
      endTime: future,
      text: 'Vento muito forte',
    },
  ];

  it('fetches and filters border districts, active warnings, non-green', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockWarnings,
    } as Response);

    const warnings = await fetchIpmaWarnings();

    expect(warnings.length).toBe(2);
    expect(warnings[0].districtCode).toBe('VCT');
    expect(warnings[0].level).toBe(2);
    expect(warnings[0].type).toBe('Vento');
    expect(warnings[1].districtCode).toBe('BRG');
    expect(warnings[1].level).toBe(1);
  });

  it('filters warnings by sector correctly', () => {
    const sample: IpmaWarning[] = [
      {
        id: '1',
        districtCode: 'VCT',
        districtName: 'Viana do Castelo',
        type: 'Vento',
        level: 2,
        levelName: 'orange',
        startTime: new Date(),
        endTime: new Date(now + 3600_000),
        description: 'Vento',
      },
      {
        id: '2',
        districtCode: 'BRG',
        districtName: 'Braga',
        type: 'Chuva',
        level: 1,
        levelName: 'yellow',
        startTime: new Date(),
        endTime: new Date(now + 3600_000),
        description: 'Chuva',
      },
      {
        id: '3',
        districtCode: 'VRL',
        districtName: 'Vila Real',
        type: 'Trovoada',
        level: 2,
        levelName: 'orange',
        startTime: new Date(),
        endTime: new Date(now + 3600_000),
        description: 'Trovoada',
      },
    ];

    // Rías: only Viana do Castelo (VCT)
    const rias = getIpmaWarningsForSector(sample, 'rias');
    expect(rias.map((w) => w.districtCode)).toEqual(['VCT']);

    // Embalse: VRL, BRG, VCT
    const embalse = getIpmaWarningsForSector(sample, 'embalse');
    expect(embalse.length).toBe(3);
  });
});
