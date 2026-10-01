/**
 * Rows for the METAR archive (`metar_reports`) from the aviationweather.gov JSON.
 *
 * The map already reads these reports live (src/api/metarClient.ts) but nothing kept them, so
 * the one certified visibility sensor at the mouth of the Ría de Vigo (LEVX, Peinador) never
 * became history. With it stored, fog and mist have a measured label: present weather FG/BR/BCFG
 * plus visibility, every 30 minutes. Pure, so the tests run on real payloads.
 *
 * Everything the report says is kept, raw text included, and nothing is filtered before
 * storing: what counts as fog is decided when the data is read, and that decision can change.
 */
import { parseMetarVisibilityKm } from '../src/api/metarParse.js';

export interface MetarRow {
  icao: string;
  obsTime: Date;
  /** km; 10 = «10 km or more» (CAVOK, 9999, "6+") */
  visibilityKm: number | null;
  /** Present weather as reported (FG, BR, BCFG, -RA...), null when none */
  wx: string | null;
  tempC: number | null;
  dewpointC: number | null;
  /** Degrees; null when variable (VRB) or calm without direction */
  windDir: number | null;
  windKt: number | null;
  gustKt: number | null;
  /** Sea-level pressure, hPa */
  pressureHpa: number | null;
  /** Overall cover as reported (CAVOK, FEW, OVC...) */
  cover: string | null;
  /** Layers as "FEW008 BKN020" (base in feet) */
  clouds: string | null;
  rawOb: string;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function layers(v: unknown): string | null {
  if (!Array.isArray(v)) return null;
  const out = v
    .map((l) => {
      const cover = text((l as { cover?: unknown })?.cover);
      const base = num((l as { base?: unknown })?.base);
      if (!cover) return null;
      return base == null ? cover : `${cover}${String(Math.round(base / 100)).padStart(3, '0')}`;
    })
    .filter((s): s is string => s !== null);
  return out.length > 0 ? out.join(' ') : null;
}

/** One row per report with a station, a time and the raw text; anything else may be null. */
export function metarRows(payload: unknown): MetarRow[] {
  if (!Array.isArray(payload)) return [];
  const rows: MetarRow[] = [];
  for (const raw of payload) {
    if (raw == null || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    const icao = text(m.icaoId);
    const obs = num(m.obsTime); // epoch SECONDS
    const rawOb = text(m.rawOb);
    if (!icao || obs == null || !rawOb) continue;
    rows.push({
      icao,
      obsTime: new Date(obs * 1000),
      visibilityKm: parseMetarVisibilityKm(m.visib as string | number | undefined, rawOb),
      wx: text(m.wxString),
      tempC: num(m.temp),
      dewpointC: num(m.dewp),
      windDir: num(m.wdir), // "VRB" is a string → null
      windKt: num(m.wspd),
      gustKt: num(m.wgst),
      pressureHpa: num(m.altim),
      cover: text(m.cover),
      clouds: layers(m.clouds),
      rawOb,
    });
  }
  return rows;
}
