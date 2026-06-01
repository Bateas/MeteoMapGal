/**
 * Daily summary service for the ingestor.
 *
 * Runs at 9:00 AM — builds a PER-SPOT briefing (the verdict the user trusts)
 * and POSTs to n8n webhook for Telegram delivery. Both sectors in one message.
 *
 * Design (S136+3+7 alert audit): the summary reports each sector's SAILABLE
 * spots (read from the `spot_scores` the analyzer persists every cycle) +
 * real marine obs (waves/water temp, Rías only). It deliberately does NOT
 * send regional averages (mean humidity, cross-station temp spread, lone
 * peak-wind) — those don't change a decision and read as noise. This is the
 * base for the future PWA push alerts.
 */

import { getPool } from './db.js';
import { log } from './logger.js';
import { msToKnots, degreesToCardinal } from '../src/services/windUtils.js';
import { ALL_SPOTS } from '../src/config/spots.js';

// ── Config ──────────────────────────────────────────

const SUMMARY_HOUR = 9;
const N8N_WEBHOOK = process.env.N8N_SUMMARY_WEBHOOK || 'http://REDACTED_N8N_HOST:5678/webhook/meteomap-summary';

/** Sector definitions (matching src/config/sectors.ts) */
const SECTORS = [
  { id: 'rias', name: 'Rías Baixas', center: [-8.68, 42.30], radiusKm: 40, coastal: true },
  { id: 'embalse', name: 'Embalse de Castrelo', center: [-8.1, 42.29], radiusKm: 35, coastal: false },
] as const;

/** spot_id → short display name. */
const SPOT_SHORT = new Map<string, string>(ALL_SPOTS.map((s) => [s.id, s.shortName]));

/** Internal verdict → display label + emoji. Only sailable verdicts surface. */
const VERDICT_DISPLAY: Record<string, { label: string; emoji: string }> = {
  sailing: { label: 'navegable', emoji: '🟢' },
  good:    { label: 'bueno',     emoji: '🟡' },
  strong:  { label: 'fuerte',    emoji: '🔴' },
};
const SAILABLE = new Set(['sailing', 'good', 'strong']);
/** Verdict ordering for "best first" display. */
const VERDICT_RANK: Record<string, number> = { good: 3, strong: 2, sailing: 1 };

/** Boost provenance → short human note. */
function boostNote(boostedBy: string | null): string {
  if (!boostedBy) return '';
  if (boostedBy.includes('canaliz')) return ' · canalización';
  if (boostedBy.includes('bocana')) return ' · bocana';
  if (boostedBy.includes('thermal') || boostedBy.includes('term')) return ' · térmico';
  return '';
}

// ── State ───────────────────────────────────────────

let lastSummaryDate = '';

// ── Types ───────────────────────────────────────────

interface SpotLine {
  shortName: string;
  verdict: string;       // internal: sailing/good/strong
  windKt: number;
  dir: string;           // cardinal
  boostedBy: string | null;
}

interface SectorSummary {
  name: string;
  coastal: boolean;
  stationCount: number;
  spots: SpotLine[];               // sailable spots, best first
  maxWaveHeight: number | null;    // Rías only
  maxWaveStation: string;
  waterTemp: number | null;        // Rías only
}

// ── DB queries ──────────────────────────────────────

/** Sailable spots for a sector, latest verdict per spot (last 90 min). */
async function querySpotVerdicts(sectorId: string): Promise<SpotLine[]> {
  const db = getPool();
  try {
    const res = await db.query<{
      spot_id: string; verdict: string; wind_kt: number | null;
      wind_dir: number | null; boosted_by: string | null;
    }>(`
      SELECT DISTINCT ON (spot_id)
        spot_id, verdict, wind_kt, wind_dir, boosted_by
      FROM spot_scores
      WHERE sector = $1 AND time > NOW() - INTERVAL '90 minutes'
      ORDER BY spot_id, time DESC
    `, [sectorId]);

    const lines: SpotLine[] = [];
    for (const r of res.rows) {
      if (!SAILABLE.has(r.verdict)) continue;
      lines.push({
        shortName: SPOT_SHORT.get(r.spot_id) ?? r.spot_id,
        verdict: r.verdict,
        windKt: r.wind_kt != null ? Math.round(r.wind_kt) : 0,
        dir: r.wind_dir != null ? degreesToCardinal(r.wind_dir) : '',
        boostedBy: r.boosted_by,
      });
    }
    // Best verdict first, then strongest wind.
    lines.sort((a, b) =>
      (VERDICT_RANK[b.verdict] ?? 0) - (VERDICT_RANK[a.verdict] ?? 0) || b.windKt - a.windKt);
    return lines;
  } catch (err) {
    log.warn(`Spot verdicts query failed for ${sectorId}: ${(err as Error).message}`);
    return [];
  }
}

async function querySectorSummary(sectorId: string): Promise<SectorSummary | null> {
  const db = getPool();
  const sector = SECTORS.find(s => s.id === sectorId);
  if (!sector) return null;

  try {
    // Active station count within sector bbox (last 30 min) — coverage signal.
    const latRange = sector.radiusKm / 111;
    const lonRange = sector.radiusKm / 85;
    const countRes = await db.query<{ n: string }>(`
      SELECT COUNT(DISTINCT r.station_id)::int AS n
      FROM readings r
      JOIN stations s ON s.station_id = r.station_id
      WHERE r.time > NOW() - INTERVAL '30 minutes'
        AND s.latitude BETWEEN $1 AND $2
        AND s.longitude BETWEEN $3 AND $4
    `, [
      sector.center[1] - latRange, sector.center[1] + latRange,
      sector.center[0] - lonRange, sector.center[0] + lonRange,
    ]);
    const stationCount = Number(countRes.rows[0]?.n ?? 0);
    if (stationCount === 0) return null;

    const spots = await querySpotVerdicts(sectorId);

    // Marine obs ONLY for coastal sectors. Embalse is an inland reservoir — it
    // has no buoys, so never attach waves/water temp (was a bug: Embalse showed
    // a Rías buoy wave). Buoys are all in Rías, so no extra geo filter needed.
    let maxWave = 0, maxWaveStation = '', waterTemp: number | null = null;
    if (sector.coastal) {
      const buoyRes = await db.query<{
        station_name: string; wave_height: number | null; water_temp: number | null;
      }>(`
        SELECT DISTINCT ON (station_id) station_name, wave_height, water_temp
        FROM buoy_readings
        WHERE time > NOW() - INTERVAL '2 hours'
          AND (wave_height IS NOT NULL OR water_temp IS NOT NULL)
        ORDER BY station_id, time DESC
      `);
      for (const b of buoyRes.rows) {
        if (b.wave_height != null && b.wave_height > maxWave) {
          maxWave = b.wave_height;
          maxWaveStation = b.station_name;
        }
        if (b.water_temp != null && waterTemp === null) waterTemp = b.water_temp;
      }
    }

    return {
      name: sector.name,
      coastal: sector.coastal,
      stationCount,
      spots,
      maxWaveHeight: maxWave > 0 ? maxWave : null,
      maxWaveStation,
      waterTemp,
    };
  } catch (err) {
    log.error(`Summary query failed for ${sectorId}:`, (err as Error).message);
    return null;
  }
}

// ── Build & send ────────────────────────────────────

/** Per-sector block. Exported pure for testing. */
export function buildSectorBlock(s: SectorSummary): string {
  let block = `*${s.name}*\n`;

  if (s.spots.length > 0) {
    for (const sp of s.spots.slice(0, 6)) {
      const d = VERDICT_DISPLAY[sp.verdict];
      const windStr = sp.windKt > 0 ? ` ${sp.windKt}kt${sp.dir ? ' ' + sp.dir : ''}` : '';
      block += `${d.emoji} ${sp.shortName} ${d.label}${windStr}${boostNote(sp.boostedBy)}\n`;
    }
  } else {
    block += 'Sin condiciones de vela ahora\n';
  }

  // Real marine obs — coastal only.
  if (s.coastal) {
    const marine: string[] = [];
    if (s.maxWaveHeight != null) marine.push(`Olas ${s.maxWaveHeight.toFixed(1)}m${s.maxWaveStation ? ` (${s.maxWaveStation})` : ''}`);
    if (s.waterTemp != null) marine.push(`Agua ${s.waterTemp.toFixed(0)}°`);
    if (marine.length > 0) block += marine.join(' · ') + '\n';
  }

  return block;
}

/** Full message. Exported pure for testing. */
export function buildMessage(sectors: (SectorSummary | null)[], now: Date): string {
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  let msg = '*Resumen diario MeteoMapGal*\n';
  msg += `${days[now.getDay()]} ${now.getDate()} de ${months[now.getMonth()]}\n\n`;

  for (const s of sectors) {
    if (!s) continue;
    msg += buildSectorBlock(s) + '\n';
  }

  msg += '_meteomapgal.navia3d.com_';
  return msg;
}

async function sendToN8n(message: string): Promise<boolean> {
  try {
    const res = await fetch(N8N_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (err) {
    log.error('n8n webhook failed:', (err as Error).message);
    return false;
  }
}

// ── Public API ──────────────────────────────────────

/**
 * Check if daily summary should be sent and send it.
 * Call this from the main poll loop — it self-throttles to once per day.
 */
export async function checkAndSendDailySummary(): Promise<void> {
  const now = new Date();
  const hour = now.getHours();
  const todayStr = now.toDateString();

  if (hour !== SUMMARY_HOUR) return;
  if (lastSummaryDate === todayStr) return;

  log.info('Generating daily summary...');

  const [rias, embalse] = await Promise.all([
    querySectorSummary('rias'),
    querySectorSummary('embalse'),
  ]);

  if (!rias && !embalse) {
    log.warn('No data for daily summary — skipping');
    return;
  }

  const message = buildMessage([rias, embalse], now);
  const ok = await sendToN8n(message);

  if (ok) {
    lastSummaryDate = todayStr;
    log.ok('Daily summary sent to Telegram');
  } else {
    log.warn('Daily summary failed — will retry next cycle');
  }
}
