/**
 * AEMET Avisos Meteorológicos — CAP XML parser.
 * Fetches official weather warnings and filters by Galician zones.
 *
 * AEMET zones for Galicia:
 * - 36xxxx = Pontevedra (Rías Baixas)
 * - 32xxxx = Ourense (Embalse sector)
 * - 15xxxx = A Coruña
 * - 27xxxx = Lugo
 *
 * Levels: verde (green), amarillo (yellow), naranja (orange), rojo (red)
 */

const CACHE_TTL_MS = 15 * 60_000; // 15 min cache

export interface AemetAviso {
  event: string;        // "Aviso de viento de nivel amarillo"
  level: 'verde' | 'amarillo' | 'naranja' | 'rojo';
  severity: string;     // "Minor" | "Moderate" | "Severe" | "Extreme"
  areaDesc: string;     // "Rías Baixas"
  zoneCode: string;     // "613601"
  onset: string;        // ISO date
  expires: string;      // ISO date
  headline: string;
}

let cache: { data: AemetAviso[]; fetchedAt: number } | null = null;

/** Galician zone code prefixes */
const GALICIA_PREFIXES = ['36', '32', '15', '27'];

/** Parse CAP XML and extract Galician warnings above verde */
function parseCAP(xml: string): AemetAviso[] {
  const avisos: AemetAviso[] = [];

  // Split into <info> blocks
  const infoBlocks = xml.split('<info>').slice(1);

  for (const block of infoBlocks) {
    // Extract event
    const eventMatch = block.match(/<event>(.*?)<\/event>/);
    const event = eventMatch?.[1] || '';

    // Extract level
    const levelMatch = block.match(/<value>(verde|amarillo|naranja|rojo)<\/value>/);
    const level = (levelMatch?.[1] || 'verde') as AemetAviso['level'];

    // Skip verde (no warning)
    if (level === 'verde') continue;

    // Extract severity
    const sevMatch = block.match(/<severity>(.*?)<\/severity>/);
    const severity = sevMatch?.[1] || '';

    // Extract headline
    const headlineMatch = block.match(/<headline>(.*?)<\/headline>/);
    const headline = headlineMatch?.[1] || event;

    // Extract onset/expires
    const onsetMatch = block.match(/<onset>(.*?)<\/onset>/);
    const expiresMatch = block.match(/<expires>(.*?)<\/expires>/);

    // Extract areas — can have multiple <area> per <info>
    const areaBlocks = block.split('<area>').slice(1);
    for (const area of areaBlocks) {
      const descMatch = area.match(/<areaDesc>(.*?)<\/areaDesc>/);
      const codeMatch = area.match(/<value>(\d{6})<\/value>/);

      if (!codeMatch) continue;
      const zoneCode = codeMatch[1];

      // Filter: only Galician zones (prefix 61 + province 2 digits)
      const provinceCode = zoneCode.substring(2, 4);
      if (!GALICIA_PREFIXES.includes(provinceCode)) continue;

      avisos.push({
        event,
        level,
        severity,
        areaDesc: descMatch?.[1] || '',
        zoneCode,
        onset: onsetMatch?.[1] || '',
        expires: expiresMatch?.[1] || '',
        headline,
      });
    }
  }

  // Deduplicate by event + zone
  const seen = new Set<string>();
  return avisos.filter((a) => {
    const key = `${a.event}-${a.zoneCode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchAemetAvisos(): Promise<AemetAviso[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  try {
    // Step 1: get data URL via ingestor AEMET proxy (key injected server-side)
    const step1 = await fetch(`/api/v1/aemet/api/avisos_cap/ultimoelaborado/area/61`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!step1.ok) return cache?.data ?? [];

    const meta = await step1.json();
    if (!meta.datos) return cache?.data ?? [];

    // Step 2: fetch actual CAP XML via ingestor proxy (signed URL, no key needed)
    const parsed = new URL(meta.datos);
    const step2Url = `/api/v1/aemet-data${parsed.pathname}${parsed.search}`;
    const step2 = await fetch(step2Url, { signal: AbortSignal.timeout(15_000) });
    if (!step2.ok) return cache?.data ?? [];

    const xml = await step2.text();
    const avisos = parseCAP(xml);

    cache = { data: avisos, fetchedAt: Date.now() };
    return avisos;
  } catch {
    return cache?.data ?? [];
  }
}

/** Filter avisos relevant to a specific zone (by concello proximity) */
export function filterAvisosByProvince(avisos: AemetAviso[], provinceCode: '36' | '32'): AemetAviso[] {
  return avisos.filter((a) => a.zoneCode.substring(2, 4) === provinceCode);
}

/** Level colors for display */
export const AVISO_COLORS: Record<AemetAviso['level'], { bg: string; text: string; label: string }> = {
  verde: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Verde' },
  amarillo: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Amarillo' },
  naranja: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Naranja' },
  rojo: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Rojo' },
};
