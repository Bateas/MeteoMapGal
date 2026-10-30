/**
 * Browser reports of what the page's security policy (CSP) blocked, so a week of Report-Only says
 * which host the closed list misses before it becomes the real header (asked by infra, 30-oct).
 *
 * Two formats reach us: the old `report-uri` one (`application/csp-report`, `{"csp-report": {...}}`,
 * the only one Firefox sends) and the Reporting API one (`application/reports+json`, an array of
 * `{type: "csp-violation", body: {...}}`). Only the directive and the blocked host are kept: no IP,
 * no page address, no script sample. Anything that does not look like one of the two is dropped.
 */

export interface CspViolation {
  directive: string;
  blocked: string;
}

/** At most this many violations are read from one request; a real one carries one. */
export const CSP_MAX_PER_REQUEST = 10;

const DIRECTIVE = /^[a-z][a-z-]{1,39}$/;
// What the browser writes instead of a URL when the blocked thing has none.
const KEYWORDS = new Set(['inline', 'eval', 'wasm-eval', 'data', 'blob', 'self', 'trusted-types-policy', 'trusted-types-sink']);

/** `script-src-elem` stays as it is; `script-src 'self' https://x` (old browsers) keeps only the name. */
function directiveOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return DIRECTIVE.test(name) ? name : null;
}

/** The host of a blocked URL, or the keyword the browser wrote. Never the path or the query. */
export function blockedHostOf(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  const s = raw.trim().toLowerCase();
  if (KEYWORDS.has(s)) return s;
  if (s === 'data:' || s.startsWith('data:')) return 'data';
  if (s === 'blob:' || s.startsWith('blob:')) return 'blob';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:' && u.protocol !== 'wss:' && u.protocol !== 'ws:') return null;
    return u.protocol === 'https:' ? u.host : `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function violationOf(body: unknown): CspViolation | null {
  if (body == null || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const directive = directiveOf(b['effective-directive'] ?? b.effectiveDirective ?? b['violated-directive']);
  const blocked = blockedHostOf(b['blocked-uri'] ?? b.blockedURL ?? b.blockedUri);
  return directive && blocked ? { directive, blocked } : null;
}

/** Violations in a report body, whichever of the two formats it is. Bad input gives []. */
export function parseCspReports(text: string): CspViolation[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const out: CspViolation[] = [];
  if (Array.isArray(data)) {
    for (const r of data.slice(0, CSP_MAX_PER_REQUEST)) {
      if (r && typeof r === 'object' && (r as { type?: unknown }).type === 'csp-violation') {
        const v = violationOf((r as { body?: unknown }).body);
        if (v) out.push(v);
      }
    }
  } else if (data && typeof data === 'object') {
    const v = violationOf((data as Record<string, unknown>)['csp-report']);
    if (v) out.push(v);
  }
  return out;
}
