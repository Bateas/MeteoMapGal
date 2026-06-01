/**
 * Daily summary service for the ingestor.
 *
 * Runs at 9:00 AM — a concise MORNING BRIEFING of what to EXPECT today per
 * sector (read from the day's forecast, not the calm 9am snapshot) + which
 * spots that wind direction favours + real marine obs. POSTs to n8n webhook
 * for Telegram delivery.
 *
 * Design (S136+3+7 alert audit, phase 2): the forecast in the ingestor is one
 * model point PER SECTOR (not per spot), so the honest forecast granularity is
 * a per-sector outlook — faking per-spot forecast precision would be
 * unreliable data, which we avoid. We DO name the spots the outlook direction
 * favours, derived from each spot's curated windPatterns (real local knowledge,
 * e.g. SW → Cesantes/Lourido; Liméns only on N). The outlook reads actual wind
 * so it captures thermal (SW), nortada (N) and frontal alike. No regional
 * averages (mean humidity, temp spread, lone peak wind) — they don't change a
 * decision. Base for the future PWA push alerts.
 */

import { getPool } from './db.js';
import { log } from './logger.js';
import { msToKnots, degreesToCardinal, angleDifference } from '../src/services/windUtils.js';
import { getAllForecasts } from './forecastFetcher.js';
import { getSpotsForSector } from '../src/config/spots.js';
import type { HourlyForecast } from '../src/types/forecast.js';

// ── Config ──────────────────────────────────────────

const SUMMARY_HOUR = 9;
const N8N_WEBHOOK = process.env.N8N_SUMMARY_WEBHOOK || 'http://REDACTED_N8N_HOST:5678/webhook/meteomap-summary';

/** Sector definitions (matching src/config/sectors.ts) */
const SECTORS = [
  { id: 'rias', name: 'Rías Baixas', center: [-8.68, 42.30], radiusKm: 40, coastal: true },
  { id: 'embalse', name: 'Embalse de Castrelo', center: [-8.1, 42.29], radiusKm: 35, coastal: false },
] as const;

const NAVEGABLE_KT = 8;   // wind ≥ this (kt) = worth sailing
const STRONG_KT = 25;     // wind ≥ this (kt) = strong / caution
const DAY_START = 8;
const DAY_END = 21;
const DIR_MATCH_TOLERANCE = 50; // ° — spot windPattern vs outlook direction

// ── State ───────────────────────────────────────────

let lastSummaryDate = '';

// ── Types ───────────────────────────────────────────

interface DayOutlook {
  startHour: number;
  endHour: number;
  peakKt: number;
  dirDeg: number;                       // dominant direction (degrees)
  dir: string;                          // cardinal
  pattern: 'térmico' | 'nortada' | '';  // recognised Galician pattern
  strong: boolean;
}

interface SectorSummary {
  name: string;
  coastal: boolean;
  stationCount: number;
  outlook: DayOutlook | null;      // null = light all day
  favoredSpots: string[];          // spots whose patterns suit the outlook dir
  maxWaveHeight: number | null;    // coastal only
  maxWaveStation: string;
  waterTemp: number | null;        // coastal only
}

// ── Forecast outlook (pure) ─────────────────────────

/**
 * Summarise the day's main wind window from the sector forecast: the span of
 * remaining daytime hours with sailable wind, its peak and dominant direction.
 * Returns null when it stays light all day. Captures thermal/nortada/frontal
 * alike (reads actual wind, not just thermal heuristics).
 */
export function summarizeDayOutlook(hourly: HourlyForecast[], now: Date): DayOutlook | null {
  const today = now.toDateString();
  const fromHour = Math.max(now.getHours(), DAY_START);

  const sailable = hourly.filter((f) => {
    if (f.time.toDateString() !== today) return false;
    const h = f.time.getHours();
    if (h < fromHour || h > DAY_END) return false;
    return f.windSpeed != null && msToKnots(f.windSpeed) >= NAVEGABLE_KT;
  });
  if (sailable.length === 0) return null;

  let startHour = 99, endHour = 0, peakKt = 0;
  let sinSum = 0, cosSum = 0, dirN = 0;
  for (const f of sailable) {
    const h = f.time.getHours();
    if (h < startHour) startHour = h;
    if (h > endHour) endHour = h;
    const kt = msToKnots(f.windSpeed!);
    if (kt > peakKt) peakKt = kt;
    if (f.windDirection != null) {
      const r = (f.windDirection * Math.PI) / 180;
      sinSum += Math.sin(r); cosSum += Math.cos(r); dirN++;
    }
  }
  const dirDeg = dirN > 0 ? (((Math.atan2(sinSum, cosSum) * 180) / Math.PI) + 360) % 360 : -1;
  const pattern: DayOutlook['pattern'] =
    dirDeg < 0 ? ''
    : (dirDeg >= 200 && dirDeg <= 260) ? 'térmico'   // SW
    : (dirDeg >= 310 || dirDeg <= 30) ? 'nortada'    // N
    : '';

  return {
    startHour, endHour,
    peakKt: Math.round(peakKt),
    dirDeg,
    dir: dirDeg >= 0 ? degreesToCardinal(dirDeg) : '',
    pattern,
    strong: peakKt >= STRONG_KT,
  };
}

/**
 * Spots in a sector whose curated windPatterns suit the outlook direction.
 * Pure local knowledge — NOT faked forecast precision. e.g. SW → Cesantes,
 * Lourido; Liméns appears only when N/NNW. Excludes surf spots.
 */
export function spotsFavoredByDir(sectorId: string, dirDeg: number): string[] {
  if (dirDeg < 0) return [];
  // Match ONLY the primary (first) windPattern — by convention it's the spot's
  // good wind. The list also holds marginal patterns (e.g. Liméns "Sur fuerte
  // pero no ideal"), and matching those would mislead (Liméns would show on a
  // SW day when it only really works on N).
  return getSpotsForSector(sectorId)
    .filter((s) => s.category !== 'surf'
      && s.windPatterns.length > 0
      && angleDifference(s.windPatterns[0].direction, dirDeg) <= DIR_MATCH_TOLERANCE)
    .map((s) => s.shortName);
}

/** One concise outlook line. Exported pure for testing. */
export function formatOutlook(o: DayOutlook | null): string {
  if (!o) return 'Flojo hoy · sin viento de vela';
  const tag = o.pattern ? ` (${o.pattern})` : '';
  const dir = o.dir ? ` ${o.dir}` : '';
  const span = o.startHour === o.endHour ? `${o.startHour}h` : `${o.startHour}-${o.endHour}h`;
  if (o.strong) return `⚠️ Viento fuerte ${span} · hasta ${o.peakKt}kt${dir}${tag}`;
  return `Navegable ${span} · hasta ${o.peakKt}kt${dir}${tag}`;
}

// ── DB queries ──────────────────────────────────────

async function querySectorSummary(
  sectorId: string,
  hourly: HourlyForecast[],
  now: Date,
): Promise<SectorSummary | null> {
  const db = getPool();
  const sector = SECTORS.find(s => s.id === sectorId);
  if (!sector) return null;

  try {
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

    const outlook = summarizeDayOutlook(hourly, now);
    const favoredSpots = outlook ? spotsFavoredByDir(sectorId, outlook.dirDeg) : [];

    // Marine obs ONLY for coastal sectors. Embalse is an inland reservoir with
    // no buoys — never attach waves/water temp (was a bug). All buoys are Rías.
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

    if (stationCount === 0 && !outlook && maxWave === 0 && waterTemp === null) return null;

    return {
      name: sector.name,
      coastal: sector.coastal,
      stationCount,
      outlook,
      favoredSpots,
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
  block += formatOutlook(s.outlook) + '\n';

  // Spots the outlook direction favours (cap 4 to stay concise).
  if (s.outlook && s.favoredSpots.length > 0) {
    const shown = s.favoredSpots.slice(0, 4).join(' · ');
    const extra = s.favoredSpots.length > 4 ? ' …' : '';
    block += `🏄 ${shown}${extra}\n`;
  }

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

  let forecasts: Map<string, HourlyForecast[]>;
  try {
    forecasts = await getAllForecasts();
  } catch (err) {
    log.warn(`Daily summary forecast fetch failed: ${(err as Error).message}`);
    forecasts = new Map();
  }

  const [rias, embalse] = await Promise.all([
    querySectorSummary('rias', forecasts.get('rias') ?? [], now),
    querySectorSummary('embalse', forecasts.get('embalse') ?? [], now),
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
