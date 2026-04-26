/**
 * MeteoGalicia Adverse Weather Warnings client.
 *
 * Fetches and parses the RSS feed of official warnings from MeteoGalicia.
 * These are authoritative alerts from the Galician meteorological agency
 * covering storms, waves, wind, rain, snow, fog, heat, cold.
 *
 * Feed URL: /meteogalicia-api/mgrss/predicion/rssAdversos.action?request_locale=gl
 *
 * Zone IDs relevant to our sectors:
 * - Embalse: 323 (Interior A Coruña), 335 (Interior Pontevedra), 334 (Miño Pontevedra)
 * - Rías:    336 (Costa Pontevedra), 400 (Rías Baixas mar), 401 (Costa da Morte mar),
 *            321 (Noroeste A Coruña)
 *
 * Warning levels: 1=amarillo (yellow), 2=naranja (orange), 3=rojo (red)
 */

// ── Types ────────────────────────────────────────────────

export interface MGWarning {
  /** Alert type: Tormenta, Ondas, Vento, Choiva, Neve, Néboa, Calor, Frío */
  type: string;
  /** Alert type ID from MG */
  typeId: number;
  /** Maximum level across all zones: 1=amarillo, 2=naranja, 3=rojo */
  maxLevel: number;
  /** Affected zones with individual levels and time windows */
  zones: MGWarningZone[];
  /** Original RSS pubDate */
  publishedAt: Date;
  /** Link to MG warning page */
  link: string;
}

export interface MGWarningZone {
  /** Zone name in Galician */
  name: string;
  /** Zone ID from MG */
  id: number;
  /** Alert level for this zone: 1/2/3 */
  level: number;
  /** Start of warning period */
  startTime: Date;
  /** End of warning period */
  endTime: Date;
  /** Description/commentary */
  comment: string;
}

// ── Zone mapping to our sectors ──────────────────────────

/** MG zone IDs relevant to Embalse de Castrelo (interior Galicia) */
const EMBALSE_ZONES = new Set([
  323,  // Interior A Coruña
  335,  // Interior Pontevedra
  334,  // Miño Pontevedra
  324,  // Interior Lugo
  333,  // Interior Ourense
]);

/** MG zone IDs relevant to Rías Baixas (coastal) */
const RIAS_ZONES = new Set([
  336,  // Costa Pontevedra
  400,  // Rías Baixas (mar)
  401,  // Costa da Morte (mar)
  321,  // Noroeste A Coruña
  338,  // Coruña Noroeste (mar)
  322,  // Costa A Coruña
]);

/** Warning types relevant to storm prediction */
const STORM_TYPES = new Set(['Tormenta', 'Tormenta eléctrica', 'Treboada']);
const WAVE_TYPES = new Set(['Ondas', 'Olas']);
const WIND_TYPES = new Set(['Vento', 'Viento']);
const RAIN_TYPES = new Set(['Choiva', 'Lluvia', 'Chuvia']);

// ── Fetch + Parse ────────────────────────────────────────

const FEED_URL = '/meteogalicia-api/mgrss/predicion/rssAdversos.action?request_locale=gl';
const CACHE_MS = 15 * 60_000; // 15 min cache

let cachedWarnings: MGWarning[] = [];
let lastFetch = 0;

/**
 * Fetch current MG adverse warnings. Returns cached data if fresh.
 */
export async function fetchMGWarnings(): Promise<MGWarning[]> {
  if (Date.now() - lastFetch < CACHE_MS) {
    return cachedWarnings;
  }

  try {
    const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      console.warn(`[MG Warnings] HTTP ${res.status}`);
      return cachedWarnings;
    }

    const xml = await res.text();
    cachedWarnings = parseWarningsXML(xml);
    lastFetch = Date.now();
    return cachedWarnings;
  } catch (err) {
    console.warn('[MG Warnings] Fetch failed:', err);
    return cachedWarnings;
  }
}

/**
 * Get warnings relevant to a specific sector, optionally filtered by type.
 */
export function getWarningsForSector(
  warnings: MGWarning[],
  sectorId: 'embalse' | 'rias',
): MGWarning[] {
  const zoneSet = sectorId === 'embalse' ? EMBALSE_ZONES : RIAS_ZONES;
  const now = Date.now();

  return warnings
    .map((w) => {
      // Filter zones to only those matching our sector AND currently active
      const relevantZones = w.zones.filter(
        (z) => zoneSet.has(z.id) && z.endTime.getTime() > now,
      );
      if (relevantZones.length === 0) return null;
      return {
        ...w,
        zones: relevantZones,
        maxLevel: Math.max(...relevantZones.map((z) => z.level)),
      };
    })
    .filter((w): w is MGWarning => w !== null);
}

/**
 * Check if any storm-type warning is active for a sector.
 * Returns the max level (0=none, 1=yellow, 2=orange, 3=red).
 */
export function getStormWarningLevel(
  warnings: MGWarning[],
  sectorId: 'embalse' | 'rias',
): number {
  const sectorWarnings = getWarningsForSector(warnings, sectorId);
  const stormWarnings = sectorWarnings.filter((w) =>
    STORM_TYPES.has(w.type) || RAIN_TYPES.has(w.type),
  );
  if (stormWarnings.length === 0) return 0;
  return Math.max(...stormWarnings.map((w) => w.maxLevel));
}

/**
 * Classify warning type for UI display.
 */
export function classifyWarningType(type: string): 'storm' | 'wave' | 'wind' | 'rain' | 'other' {
  if (STORM_TYPES.has(type)) return 'storm';
  if (WAVE_TYPES.has(type)) return 'wave';
  if (WIND_TYPES.has(type)) return 'wind';
  if (RAIN_TYPES.has(type)) return 'rain';
  return 'other';
}

/**
 * Human-readable level label in Spanish.
 */
export function warningLevelLabel(level: number): string {
  return level === 3 ? 'Rojo' : level === 2 ? 'Naranja' : level === 1 ? 'Amarillo' : 'Sin aviso';
}

export function warningLevelColor(level: number): string {
  return level === 3 ? '#ef4444' : level === 2 ? '#f97316' : level === 1 ? '#eab308' : '#64748b';
}

// ── XML Parser ───────────────────────────────────────────

/**
 * Parse the RSS XML feed. Uses regex-based parsing (no DOMParser needed
 * for this simple well-structured feed — avoids heavy XML library).
 */
function parseWarningsXML(xml: string): MGWarning[] {
  const warnings: MGWarning[] = [];

  // Split by <item> blocks
  const items = xml.split('<item>').slice(1); // Skip header before first item

  for (const itemBlock of items) {
    const item = itemBlock.split('</item>')[0];
    if (!item) continue;

    const link = extractTag(item, 'link') ?? '';
    const pubDateStr = extractTag(item, 'pubDate') ?? '';
    const publishedAt = pubDateStr ? new Date(pubDateStr) : new Date();

    // Parse adversos:TipoAlerta
    const alertMatch = item.match(
      /TipoAlerta\s+nome="([^"]*?)"\s+idtipoalerta="(\d+)"\s+nivelMax="(\d+)"/,
    );
    if (!alertMatch) continue;

    const type = alertMatch[1];
    const typeId = parseInt(alertMatch[2], 10);
    const maxLevel = parseInt(alertMatch[3], 10);

    // Parse zones
    const zones: MGWarningZone[] = [];
    const zonaBlocks = item.split(/<zona\s/).slice(1);

    for (const zonaBlock of zonaBlocks) {
      const zonaEnd = zonaBlock.indexOf('</zona>');
      const zona = zonaEnd >= 0 ? zonaBlock.substring(0, zonaEnd) : zonaBlock;

      const nameMatch = zona.match(/nome="([^"]*?)"/);
      const idMatch = zona.match(/id="(\d+)"/);
      if (!nameMatch || !idMatch) continue;

      // Parse tramo(s) within zone
      const tramos = zona.split('<tramo>').slice(1);
      for (const tramoBlock of tramos) {
        const tramo = tramoBlock.split('</tramo>')[0];
        if (!tramo) continue;

        const startStr = extractTag(tramo, 'dataIni') ?? '';
        const endStr = extractTag(tramo, 'dataFin') ?? '';
        const levelStr = extractTag(tramo, 'nivel') ?? '0';
        const comment = extractTag(tramo, 'comentario') ?? '';

        zones.push({
          name: nameMatch[1],
          id: parseInt(idMatch[1], 10),
          level: parseInt(levelStr, 10),
          startTime: parseMGDate(startStr),
          endTime: parseMGDate(endStr),
          comment,
        });
      }
    }

    if (zones.length > 0) {
      warnings.push({ type, typeId, maxLevel, zones, publishedAt, link });
    }
  }

  return warnings;
}

/** Extract text content of a simple XML tag */
function extractTag(xml: string, tag: string): string | null {
  // Handle both <tag>content</tag> and <tag ...>content</tag>
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].trim() : null;
}

/** Parse MG date format: "DD/MM/YYYY HH:MM" → Date */
function parseMGDate(str: string): Date {
  const match = str.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!match) return new Date();
  const [, day, month, year, hour, min] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${min}:00`);
}
