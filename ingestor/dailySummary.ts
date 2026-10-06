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
import { noteSent, type PastSend } from './alertDispatcher.js';
import { msToKnots, degreesToCardinal, angleDifference } from '../src/services/windUtils.js';
import { haversineDistance } from '../src/services/geoUtils.js';
import { getAllForecasts } from './forecastFetcher.js';
import { getSpotsForSector } from '../src/config/spots.js';
import { assessSynopticRegime, upperWindAt, type UpperAirLevel } from '../src/services/synopticRegime.js';
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
// Day-hazard thresholds (O2 safety line). Rain: forecast probability + amount.
const RAIN_PROB = 55;     // % precip probability to flag rain
const RAIN_MM = 0.3;      // mm — ignore drizzle-trace noise
// Storm: uncapped instability proxy (CAPE + lifted index negative + not
// strongly capped by CIN). Framed as "riesgo" — a forecast risk, NOT a
// confirmed storm (those need real lightning, per the storm-severity rule).
// Measured 6-oct over 160 days x 2 sectors (31 days with >= 5 strikes inside the
// sector between 8 and 21 h): CAPE 1000 caught 9 of them at 31 % precision; CAPE 300
// catches 21 at 40 %. Galician storms are low-CAPE: 6-oct, 2.400 strikes, peaked at 590.
const STORM_CAPE = 300;
const STORM_LI = -2;
const STORM_CIN_MAX = 200;
// Strikes already down near the sector at send time, quoted only on a storm-risk day.
const STRIKE_LOOKBACK_MIN = 120;
const STRIKE_EXTRA_KM = 60;   // beyond the sector radius
const STRIKE_MIN_COUNT = 3;

// ── State ───────────────────────────────────────────

let lastSummaryDate = '';

/** A restart between 9 and 10 used to send the summary again. Restore today's send, if any (sentAlerts.ts). */
export function seedDailySummary(sends: PastSend[], now = new Date()): void {
  const today = now.toDateString();
  if (sends.some((s) => s.key === 'summary:daily' && new Date(s.atMs).toDateString() === today)) lastSummaryDate = today;
}

// ── Types ───────────────────────────────────────────

interface DayOutlook {
  startHour: number;
  endHour: number;
  peakKt: number;
  dirDeg: number;                       // dominant direction (degrees)
  dir: string;                          // cardinal
  /** Recognised Galician pattern. 'de frente': SW at the surface with the frontal flow
   *  aloft (synopticRegime.ts), which is not a breeze even though it blows from the SW. */
  pattern: 'térmico' | 'nortada' | 'de frente' | '';
  strong: boolean;
}

interface SectorSummary {
  name: string;
  coastal: boolean;
  stationCount: number;
  outlook: DayOutlook | null;      // null = light all day
  favoredSpots: string[];          // spots whose patterns suit the outlook dir
  hazard: DayHazard;               // rain / storm risk today (O2)
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
 * The outlook with the synoptic regime of its hours. The direction alone called the SW
 * "térmico", but a SW under a strong S-W flow at 850 hPa is the front brought down, not a
 * breeze: on 30-sep the summary said "hasta 11kt WSW (térmico)" and named Cesantes while the
 * map said "Entra viento de frente (24 kt SW a 1.500 m)" and Cesantes read 6 kt from the S
 * (checked on the webcam). The same rule as the map (assessSynopticRegime), taken over the
 * window hours: frontal in at least half of them turns 'térmico' into 'de frente'. Without
 * upper-air rows for those hours, the outlook stays as it was. Pure.
 */
export function withSynopticRegime(o: DayOutlook, levels: UpperAirLevel[], day: Date): DayOutlook {
  if (o.pattern !== 'térmico') return o;
  let frontal = 0, judged = 0;
  for (let h = o.startHour; h <= o.endHour; h++) {
    const at = new Date(day);
    at.setHours(h, 0, 0, 0);
    const regime = assessSynopticRegime(upperWindAt(levels, at.getTime()));
    if (!regime) continue;
    judged++;
    if (regime.vetoed) frontal++;
  }
  return judged > 0 && frontal * 2 >= judged ? { ...o, pattern: 'de frente' } : o;
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

// ── Day hazard (O2 safety) ──────────────────────────

interface DayHazard {
  rain: { hour: number; prob: number } | null;
  storm: boolean;
  /** First hour of the storm risk. */
  stormHour?: number;
  /** Nearest strike already down (km from the sector centre), on a storm-risk day only. */
  strikesNearKm?: number;
}

/**
 * Scan today's daytime forecast for the day's safety hazard: probable rain +
 * convective storm RISK (CAPE high + lifted index negative + not capped by
 * CIN). Pure. Storm is framed as a forecast RISK, not a confirmed storm.
 */
export function summarizeDayHazard(hourly: HourlyForecast[], now: Date): DayHazard {
  const today = now.toDateString();
  const fromHour = Math.max(now.getHours(), DAY_START);

  let rainHour = -1, rainProb = 0, stormHour = -1;
  for (const f of hourly) {
    if (f.time.toDateString() !== today) continue;
    const h = f.time.getHours();
    if (h < fromHour || h > DAY_END) continue;

    // Rain: keep the most-probable wet hour.
    if (f.precipProbability != null && f.precipProbability >= RAIN_PROB
        && (f.precipitation ?? 0) >= RAIN_MM && f.precipProbability > rainProb) {
      rainProb = f.precipProbability;
      rainHour = h;
    }
    // Storm risk: uncapped instability.
    if ((f.cape ?? 0) >= STORM_CAPE && (f.liftedIndex ?? 99) <= STORM_LI
        && (f.cin ?? 0) < STORM_CIN_MAX && (stormHour < 0 || h < stormHour)) {
      stormHour = h;
    }
  }

  return {
    rain: rainHour >= 0 ? { hour: rainHour, prob: Math.round(rainProb) } : null,
    storm: stormHour >= 0,
    ...(stormHour >= 0 ? { stormHour } : {}),
  };
}

/** Concise hazard line(s). Empty string when the day is clear. */
export function formatHazard(h: DayHazard): string {
  const parts: string[] = [];
  if (h.storm) {
    const from = h.stormHour != null ? ` desde ~${h.stormHour}h` : '';
    const near = h.strikesNearKm != null ? ` · ya hay rayos a ${h.strikesNearKm} km` : '';
    parts.push(`⛈️ Riesgo de tormenta${from}${near}`);
  }
  if (h.rain) parts.push(`🌧️ Lluvia ~${h.rain.hour}h (${h.rain.prob}%)`);
  return parts.join('\n');
}

// ── DB queries ──────────────────────────────────────

/** Today's 850 hPa rows for a sector (the synoptic fetcher stores the next 12 h). Empty on error. */
async function queryUpperAir850(sectorId: string, now: Date): Promise<UpperAirLevel[]> {
  try {
    const res = await getPool().query<{ time: Date; wind_speed_ms: number | null; wind_dir_deg: number | null }>(
      `SELECT time, wind_speed_ms, wind_dir_deg FROM upper_air_hourly
        WHERE sector = $1 AND pressure_hpa = 850 AND time BETWEEN $2 AND $3`,
      [sectorId, new Date(now.getTime() - 60 * 60_000), new Date(now.getTime() + 14 * 60 * 60_000)],
    );
    return res.rows.map((r) => ({ time: r.time, pressureHpa: 850, windSpeedMs: r.wind_speed_ms, windDirDeg: r.wind_dir_deg }));
  } catch (err) {
    log.warn(`Summary: 850 hPa not read for ${sectorId} (${(err as Error).message}), outlook without regime`);
    return [];
  }
}

/**
 * Nearest cloud-to-ground strike of the last STRIKE_LOOKBACK_MIN within the sector radius
 * plus STRIKE_EXTRA_KM. Null with fewer than STRIKE_MIN_COUNT strikes or on error.
 */
async function queryStrikesNear(sector: (typeof SECTORS)[number], now: Date): Promise<number | null> {
  const maxKm = sector.radiusKm + STRIKE_EXTRA_KM;
  const [lon0, lat0] = sector.center;
  const dLat = maxKm / 111, dLon = maxKm / 82;
  try {
    const res = await getPool().query<{ lat: number; lon: number }>(
      `SELECT lat, lon FROM lightning_strikes
        WHERE time > $1 AND cloud_to_cloud = FALSE
          AND lat BETWEEN $2 AND $3 AND lon BETWEEN $4 AND $5`,
      [new Date(now.getTime() - STRIKE_LOOKBACK_MIN * 60_000), lat0 - dLat, lat0 + dLat, lon0 - dLon, lon0 + dLon],
    );
    return nearestStrikeKm(res.rows, lat0, lon0, maxKm);
  } catch (err) {
    log.warn(`Summary: strikes not read for ${sector.id} (${(err as Error).message})`);
    return null;
  }
}

/** Pure part of queryStrikesNear: nearest strike inside maxKm, to 5 km, when there are enough of them. */
export function nearestStrikeKm(strikes: { lat: number; lon: number }[], lat0: number, lon0: number, maxKm: number): number | null {
  const km = strikes.map((s) => haversineDistance(lat0, lon0, s.lat, s.lon)).filter((d) => d <= maxKm);
  if (km.length < STRIKE_MIN_COUNT) return null;
  return Math.max(5, Math.round(Math.min(...km) / 5) * 5);
}

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

    const rawOutlook = summarizeDayOutlook(hourly, now);
    const outlook = rawOutlook ? withSynopticRegime(rawOutlook, await queryUpperAir850(sectorId, now), now) : null;
    // The spots a SW favours are the afternoon-breeze ones (their primary pattern is
    // "Brisa/Viento SW (tardes)"); with the front aloft there is no breeze to name them for.
    const favoredSpots = outlook && outlook.pattern !== 'de frente' ? spotsFavoredByDir(sectorId, outlook.dirDeg) : [];
    const hazard = summarizeDayHazard(hourly, now);
    if (hazard.storm) {
      const near = await queryStrikesNear(sector, now);
      if (near != null) hazard.strikesNearKm = near;
    }

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
      hazard,
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

/** Who the buoy data come from; italic like the footer. */
export const BUOY_CREDIT = '_Boyas: Puertos del Estado (portus.puertos.es) y Observatorio Costeiro da Xunta_';

/** Per-sector block. Exported pure for testing. */
export function buildSectorBlock(s: SectorSummary): string {
  let block = `*${s.name}*\n`;
  const storm = s.hazard.storm;
  // A storm-risk day leads with the hazard, and the wind no longer comes as a breeze to plan
  // around: the cloud and the outflows of a storm kill the thermal or turn it (6-oct).
  if (storm) block += formatHazard({ ...s.hazard, rain: null }) + '\n';
  const outlook = storm && s.outlook?.pattern === 'térmico' ? { ...s.outlook, pattern: '' as const } : s.outlook;
  block += formatOutlook(outlook) + (storm && outlook && !outlook.strong ? ' · si no hay tormenta' : '') + '\n';

  // Spots the outlook direction favours (cap 4 to stay concise). Not on a storm-risk day.
  if (!storm && s.outlook && s.favoredSpots.length > 0) {
    const shown = s.favoredSpots.slice(0, 4).join(' · ');
    const extra = s.favoredSpots.length > 4 ? ' …' : '';
    block += `🏄 ${shown}${extra}\n`;
  }

  // Day hazard (rain; the storm line went first) — O2 safety.
  const hazardLine = formatHazard(storm ? { ...s.hazard, storm: false } : s.hazard);
  if (hazardLine) block += hazardLine + '\n';

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

  // The waves and the water come from buoys. Puertos del Estado authorised their use
  // (1-oct-2026) on the condition that every use names them with the address of their portal.
  if (sectors.some((s) => s?.coastal && (s.maxWaveHeight != null || s.waterTemp != null))) {
    msg += BUOY_CREDIT + '\n';
  }

  msg += '_meteomapgal.navia3d.com_';
  return msg;
}

/** Content-Type plus the shared secret the automation backend checks when
 *  N8N_WEBHOOK_SECRET is set (Header Auth on the webhook node). Without it the
 *  hooks accept anything that can reach them. */
function webhookHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (secret) h['X-Webhook-Secret'] = secret;
  return h;
}

async function sendToN8n(message: string): Promise<boolean> {
  try {
    const res = await fetch(N8N_WEBHOOK, {
      method: 'POST',
      headers: webhookHeaders(),
      body: JSON.stringify({ text: message }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) noteSent({ key: 'summary:daily', type: 'daily-summary', level: '', title: 'Resumen diario', message, sector: null });
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
