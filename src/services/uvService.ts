/**
 * UV index service — exposure helpers for the conditions ticker.
 *
 * Galician summer is famously underestimated for UV: cool sea breeze masks
 * the actual exposure, and water reflects ~30% extra UV onto regattistas /
 * surfistas. The ticker surfaces a UV warning only when the value is
 * actionable (UV ≥ 7 during peak sun hours 12-16h local time) — the rest
 * of the day it stays quiet (reactive map philosophy).
 *
 * Pure module. No fetches, no React, no stores. The fetcher lives in a
 * separate hook so this file is trivial to test.
 */

export type UvCategory = 'low' | 'moderate' | 'high' | 'very_high' | 'extreme';

/** WHO/WMO UV index thresholds. Source: World Health Organization Global Solar UV Index. */
export function uvCategory(uv: number | null | undefined): UvCategory | null {
  if (uv == null || !Number.isFinite(uv) || uv < 0) return null;
  if (uv < 3) return 'low';
  if (uv < 6) return 'moderate';
  if (uv < 8) return 'high';
  if (uv < 11) return 'very_high';
  return 'extreme';
}

/**
 * Hex color per WHO category. Same palette as UV index meters worldwide
 * (green / yellow / orange / red / purple) so the badge is visually obvious.
 */
export function uvColor(uv: number | null | undefined): string {
  const cat = uvCategory(uv);
  switch (cat) {
    case 'low':       return '#4ade80'; // green
    case 'moderate':  return '#facc15'; // yellow
    case 'high':      return '#fb923c'; // orange
    case 'very_high': return '#ef4444'; // red
    case 'extreme':   return '#a855f7'; // purple
    default:          return '#94a3b8'; // slate fallback
  }
}

/**
 * Water-surface reflection multiplier. ~30% of incoming UV bounces off open
 * water → effective exposure higher for regattistas/surfistas/kayakers than
 * the "official" index suggests. Returns null when input is null.
 */
export function uvWaterAdjusted(uv: number | null | undefined): number | null {
  if (uv == null || !Number.isFinite(uv)) return null;
  return Math.round(uv * 1.3 * 10) / 10;
}

/**
 * Whether the current moment is "peak UV exposure window" — defaults to
 * local hours 12-16 (sun ≥45° elevation in Galicia summer). Outside this
 * window we don't surface UV warnings even if a forecast peak hits ≥7,
 * because the user can't act on info they're not exposed to.
 */
export function isPeakUvHour(now: Date = new Date()): boolean {
  const h = now.getHours();
  return h >= 12 && h < 16;
}

/**
 * Threshold for surfacing the UV badge in the ticker. WHO recommends sun
 * protection from UV ≥ 3, but a Galician audience tolerates "moderate"
 * routinely — only "high" and above are actionable warnings. Set to 7 to
 * match the upper-half of "high" and the entirety of "very high"/"extreme".
 */
export const UV_TICKER_THRESHOLD = 7;

/**
 * Short, actionable label for the ticker badge. Mentions water reflection
 * implicitly via the "+" prefix on the adjusted value, kept under 40 chars.
 *
 * Examples:
 *   uv=7  → "UV 7 ALTO · agua +9 · gorra/protector"
 *   uv=10 → "UV 10 MUY ALTO · agua +13 · cuidado"
 *   uv=12 → "UV 12 EXTREMO · agua +16 · evitar exposición"
 */
export function uvTickerLabel(uv: number): string {
  const cat = uvCategory(uv);
  const reflected = uvWaterAdjusted(uv);
  const refl = reflected != null ? ` · agua +${reflected}` : '';
  const action =
    cat === 'extreme'   ? ' · evitar exposición' :
    cat === 'very_high' ? ' · cuidado' :
    cat === 'high'      ? ' · gorra/protector' :
                          '';
  const labelCat =
    cat === 'extreme'   ? 'EXTREMO' :
    cat === 'very_high' ? 'MUY ALTO' :
    cat === 'high'      ? 'ALTO' :
    cat === 'moderate'  ? 'MOD' :
                          'BAJO';
  return `UV ${uv} ${labelCat}${refl}${action}`;
}
