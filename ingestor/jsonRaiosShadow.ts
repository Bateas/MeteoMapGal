/**
 * Shadow comparison of MeteoGalicia's official lightning JSON (jsonRaios.action) against the feed the
 * alerts read today (meteo2api `raios/lenda`), before switching. On 2-oct MeteoGalicia asked third parties
 * to use its JSON services and not meteo2api; the switch waits for one storm day with both side by side,
 * because the lightning alert depends on how fast each one publishes.
 *
 * The official service returns the whole UTC day each time (9.467 strikes and ~730 KB on 6-oct), so it is
 * asked every 10 min only while there is a storm and every hour otherwise. Nothing is stored: each pass logs
 * today's count, the last hour in both feeds, and how late the strikes it had not seen before were published.
 * Never throws, never blocks the poll.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import { isInGaliciaScope } from './lightningFetcher.js';

const JSON_RAIOS_URL = 'https://servizos.meteogalicia.gal/mgrss/observacion/jsonRaios.action';
const STORM_EVERY_MS = 10 * 60_000;
const QUIET_EVERY_MS = 60 * 60_000;

export interface JsonRaio { time: Date; lat: number; lon: number; peakCurrent: number | null }
export interface JsonRaiosDay { day: string | null; total: number | null; galicia: number | null; strikes: JsonRaio[] }

/** Pure parse of a jsonRaios.action body: {raios: [{data, listaRaios: [{fecha (UTC), lat, lon, peakCurrent}], ...}]}. */
export function parseJsonRaios(body: unknown): JsonRaiosDay {
  const day = (body as { raios?: unknown[] } | null)?.raios?.[0] as Record<string, unknown> | undefined;
  if (!day) return { day: null, total: null, galicia: null, strikes: [] };
  const strikes: JsonRaio[] = [];
  for (const r of Array.isArray(day.listaRaios) ? day.listaRaios : []) {
    const o = r as Record<string, unknown>;
    const t = typeof o.fecha === 'string' ? Date.parse(o.fecha + 'Z') : NaN;   // documented as UTC, no offset
    if (!Number.isFinite(t) || typeof o.lat !== 'number' || typeof o.lon !== 'number') continue;
    strikes.push({ time: new Date(t), lat: o.lat, lon: o.lon, peakCurrent: typeof o.peakCurrent === 'number' ? o.peakCurrent : null });
  }
  return {
    day: typeof day.data === 'string' ? day.data.slice(0, 10) : null,
    total: typeof day.numRaiosTotal === 'number' ? day.numRaiosTotal : null,
    galicia: typeof day.numRaiosGalicia === 'number' ? day.numRaiosGalicia : null,
    strikes,
  };
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

let lastRunAt = 0;
let firstPass = true;
let running = false;
let seenDay: string | null = null;
const seen = new Set<string>();

/** One pass, when due. `stormActive` comes from the lightning cycle. */
export async function runJsonRaiosShadow(stormActive: boolean): Promise<void> {
  const now = Date.now();
  if (running || now - lastRunAt < (stormActive ? STORM_EVERY_MS : QUIET_EVERY_MS)) return;
  running = true;
  lastRunAt = now;
  try {
    const res = await fetch(JSON_RAIOS_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; MeteoMapGal/1.0; +https://meteomapgal.navia3d.com)' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) { log.warn(`[jsonRaios sombra] HTTP ${res.status}`); return; }
    const d = parseJsonRaios(await res.json());
    if (d.day !== seenDay) { seen.clear(); seenDay = d.day; }
    const gal = d.strikes.filter((s) => isInGaliciaScope(s.lat, s.lon));
    const lags: number[] = [];
    for (const s of gal) {
      const k = `${s.time.getTime()}|${s.lat}|${s.lon}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!firstPass) lags.push((now - s.time.getTime()) / 60_000);
    }
    firstPass = false;
    const hourAgo = now - 60 * 60_000;
    const officialHour = gal.filter((s) => s.time.getTime() >= hourAgo).length;
    const db = await getPool().query<{ n: string }>(
      `SELECT count(*) AS n FROM lightning_strikes WHERE time >= $1 AND is_galicia = TRUE AND cloud_to_cloud = FALSE`,
      [new Date(hourAgo)],
    );
    const lendaHour = Number(db.rows[0]?.n ?? 0);
    if (gal.length > 0 || lendaHour > 0) {
      const lagText = lags.length ? `retraso de los ${lags.length} nuevos: mediana ${Math.round(median(lags))} min, max ${Math.round(Math.max(...lags))} min (paso de ${stormActive ? 10 : 60} min)` : 'sin rayos nuevos';
      log.info(`[jsonRaios sombra] dia ${d.day}: ${d.total ?? '?'} rayos (${gal.length} en la caja de Galicia) · ultima hora: ${officialHour} oficial / ${lendaHour} meteo2api · ${lagText}`);
    }
  } catch (err) {
    log.warn(`[jsonRaios sombra] fallo: ${(err as Error).message}`);
  } finally {
    running = false;
  }
}
