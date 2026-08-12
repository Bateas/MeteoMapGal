/**
 * Where the guide lives in the URL, and which sections exist.
 *
 * The guide used to WRITE `#guia/<seccion>` into the address bar while open,
 * but nothing ever read it back on boot — so the link could be copied and
 * never worked for whoever received it. This module is the one place that
 * decides what a guide URL looks like, read by both `useDeepLink` (to open
 * the modal) and `MeteoGuide` (to pick the section).
 *
 * It lives in config/ rather than in the guide folder on purpose: MeteoGuide
 * is lazy-loaded, and importing anything from it here would drag the whole
 * guide chunk into the main bundle.
 *
 * Two shapes are accepted:
 *   /guia            /guia/glossary      the shareable form
 *   #guia/glossary                       what older links already carry
 *
 * `/guia` works without touching the server: the SPA fallback already serves
 * index.html for unknown paths, and every API endpoint in the app is written
 * absolute (`/api/v1/...`), so nothing resolves relative to the new path.
 */

export interface GuideSection {
  id: string;
  label: string;
  /** If set, the section only shows in these sector IDs. */
  sectorOnly?: string[];
}

export const GUIDE_SECTIONS: GuideSection[] = [
  { id: 'intro', label: 'Introducción' },
  { id: 'datos', label: 'Qué datos recogemos' },
  { id: 'reading', label: 'Cómo leer el mapa' },
  { id: 'spots', label: 'Spots de navegación' },
  { id: 'thermal', label: 'El térmico de Castrelo', sectorOnly: ['embalse'] },
  { id: 'rias-winds', label: 'Vientos de las Rías', sectorOnly: ['rias'] },
  { id: 'panels', label: 'Paneles y alertas' },
  { id: 'history', label: 'Historial' },
  { id: 'glossary', label: 'Glosario' },
  { id: 'roadmap', label: 'Roadmap y fuentes' },
  { id: 'legal', label: 'Aviso legal' },
];

export const GUIDE_PATH = '/guia';
export const DEFAULT_GUIDE_SECTION = 'intro';

function isKnownSection(id: string): boolean {
  return GUIDE_SECTIONS.some((s) => s.id === id);
}

export interface GuideTarget {
  /** Whether the URL asks for the guide to be open. */
  open: boolean;
  section: string;
  /** True when the request came as a path, so the modal keeps writing paths. */
  viaPath: boolean;
}

/**
 * Reads a guide target out of a location. Never throws and never rejects a
 * visitor: an unknown section still opens the guide at the introduction,
 * because bouncing someone who followed a link is worse than ignoring a typo.
 */
export function parseGuideTarget(
  pathname: string,
  hash: string,
): GuideTarget {
  const path = pathname.replace(/\/+$/, '').toLowerCase();

  if (path === GUIDE_PATH || path.startsWith(`${GUIDE_PATH}/`)) {
    const rest = path.slice(GUIDE_PATH.length + 1);
    return {
      open: true,
      section: isKnownSection(rest) ? rest : DEFAULT_GUIDE_SECTION,
      viaPath: true,
    };
  }

  if (hash.startsWith('#guia/')) {
    const id = hash.slice('#guia/'.length).toLowerCase();
    return {
      open: true,
      section: isKnownSection(id) ? id : DEFAULT_GUIDE_SECTION,
      viaPath: false,
    };
  }

  return { open: false, section: DEFAULT_GUIDE_SECTION, viaPath: false };
}

/** The absolute, shareable URL for a section — what the share button copies. */
export function guideShareUrl(section: string, origin: string): string {
  const suffix = section && section !== DEFAULT_GUIDE_SECTION ? `/${section}` : '';
  return `${origin}${GUIDE_PATH}${suffix}`;
}
