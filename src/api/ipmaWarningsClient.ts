/**
 * IPMA Warnings Client — Official adverse meteorological warnings for Portugal.
 *
 * Feed: https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json
 * - Public, no API key required, CORS-enabled (*).
 * - Disticts bordering Galicia:
 *   - VCT: Viana do Castelo (Baixo Miño / Rías Baixas coast & estuary)
 *   - BRG: Braga (Baixa Limia / Peneda-Gerês)
 *   - VRL: Vila Real (Ourense sur / Verín / Chaves)
 *   - BGC: Bragança (Ourense este / A Gudiña)
 */

export interface IpmaWarningRaw {
  idAreaAviso: string;
  awarenessTypeName: string;
  awarenessLevelID: 'green' | 'yellow' | 'orange' | 'red';
  startTime: string;
  endTime: string;
  text: string;
}

export interface IpmaWarning {
  id: string;
  districtCode: string;
  districtName: string;
  type: string;
  level: number; // 1=amarillo, 2=naranja, 3=rojo
  levelName: 'yellow' | 'orange' | 'red';
  startTime: Date;
  endTime: Date;
  description: string;
}

const WARNINGS_URL = 'https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json';
const CACHE_MS = 15 * 60_000; // 15 min cache
const TIMEOUT_MS = 8_000;

let cachedWarnings: IpmaWarning[] = [];
let lastFetch = 0;

const DISTRICT_NAMES: Record<string, string> = {
  VCT: 'Viana do Castelo (Frontera Miño / Costa)',
  BRG: 'Braga (Gerês / Baixa Limia)',
  VRL: 'Vila Real (Chaves / Ourense Sur)',
  BGC: 'Bragança (Trás-os-Montes)',
};

const SEVERITY_LEVEL_MAP: Record<string, number> = {
  yellow: 1,
  orange: 2,
  red: 3,
};

/**
 * Fetch current active IPMA adverse warnings for Northern Portugal.
 */
export async function fetchIpmaWarnings(): Promise<IpmaWarning[]> {
  if (Date.now() - lastFetch < CACHE_MS && cachedWarnings.length > 0) {
    return cachedWarnings;
  }

  try {
    const res = await fetch(WARNINGS_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      console.warn(`[IPMA Warnings] HTTP ${res.status}`);
      return cachedWarnings;
    }

    const items: IpmaWarningRaw[] = await res.json();
    if (!Array.isArray(items)) {
      return cachedWarnings;
    }

    const now = Date.now();
    const borderDistricts = new Set(['VCT', 'BRG', 'VRL', 'BGC']);

    const validWarnings: IpmaWarning[] = [];

    for (const item of items) {
      // Only border districts
      if (!borderDistricts.has(item.idAreaAviso)) continue;
      // Skip green (no warning)
      if (item.awarenessLevelID === 'green') continue;

      const endTime = new Date(item.endTime);
      // Skip expired
      if (endTime.getTime() <= now) continue;

      const level = SEVERITY_LEVEL_MAP[item.awarenessLevelID] ?? 1;

      validWarnings.push({
        id: `ipma_${item.idAreaAviso}_${item.awarenessTypeName}_${item.startTime}`,
        districtCode: item.idAreaAviso,
        districtName: DISTRICT_NAMES[item.idAreaAviso] ?? item.idAreaAviso,
        type: item.awarenessTypeName,
        level,
        levelName: item.awarenessLevelID,
        startTime: new Date(item.startTime),
        endTime,
        description: item.text ?? '',
      });
    }

    // Sort by severity (descending) and start time
    validWarnings.sort((a, b) => b.level - a.level || a.startTime.getTime() - b.startTime.getTime());

    cachedWarnings = validWarnings;
    lastFetch = Date.now();
    return cachedWarnings;
  } catch (err) {
    console.warn('[IPMA Warnings] Fetch failed:', (err as Error).message);
    return cachedWarnings;
  }
}

/**
 * Filter IPMA warnings relevant to active sector:
 * - 'rias': Viana do Castelo (VCT)
 * - 'embalse': Vila Real (VRL), Braga (BRG), Viana do Castelo (VCT)
 */
export function getIpmaWarningsForSector(
  warnings: IpmaWarning[],
  sectorId: 'embalse' | 'rias' | string
): IpmaWarning[] {
  if (sectorId === 'rias') {
    return warnings.filter((w) => w.districtCode === 'VCT');
  }
  if (sectorId === 'embalse') {
    return warnings.filter((w) => ['VRL', 'BRG', 'VCT'].includes(w.districtCode));
  }
  return warnings;
}
