/**
 * Daily summary service for the ingestor.
 *
 * Runs at 9:00 AM — queries TimescaleDB for recent data from both sectors,
 * builds a summary payload, and POSTs to n8n webhook for Telegram delivery.
 *
 * Runs server-side (no browser dependency). Both sectors in one message.
 */

import { getPool } from './db.js';
import { log } from './logger.js';

// ── Config ──────────────────────────────────────────

const SUMMARY_HOUR = 9;
const N8N_WEBHOOK = process.env.N8N_SUMMARY_WEBHOOK || 'http://REDACTED_N8N_HOST:5678/webhook/meteomap-summary';

/** Sector definitions (matching src/config/sectors.ts) */
const SECTORS = [
  { id: 'rias', name: 'Rías Baixas', center: [-8.68, 42.30], radiusKm: 40 },
  { id: 'embalse', name: 'Embalse de Castrelo', center: [-8.1, 42.29], radiusKm: 35 },
] as const;

// ── State ───────────────────────────────────────────

let lastSummaryDate = '';

// ── Helpers ─────────────────────────────────────────

function msToKnots(ms: number): number {
  return ms * 1.94384;
}

interface SectorSummary {
  name: string;
  stationCount: number;
  maxWindKt: number;
  maxGustKt: number;
  maxWindStation: string;
  tempMin: number | null;
  tempMax: number | null;
  avgHumidity: number | null;
  maxWaveHeight: number | null;
  maxWaveStation: string;
  waterTemp: number | null;
}

// ── DB queries ──────────────────────────────────────

async function querySectorSummary(sectorId: string): Promise<SectorSummary | null> {
  const db = getPool();
  const sector = SECTORS.find(s => s.id === sectorId);
  if (!sector) return null;

  try {
    // Latest readings from stations (last 30 min)
    const stationRes = await db.query<{
      station_id: string; wind_speed: number | null; wind_gust: number | null;
      temperature: number | null; humidity: number | null;
    }>(`
      SELECT DISTINCT ON (station_id)
        station_id, wind_speed, wind_gust, temperature, humidity
      FROM readings
      WHERE time > NOW() - INTERVAL '30 minutes'
      ORDER BY station_id, time DESC
    `);

    const readings = stationRes.rows;
    if (readings.length === 0) return null;

    let maxWind = 0, maxGust = 0, maxWindStation = '';
    let minTemp = 999, maxTemp = -999;
    let humSum = 0, humCount = 0;

    for (const r of readings) {
      if (r.wind_speed != null && r.wind_speed > maxWind) {
        maxWind = r.wind_speed;
        maxWindStation = r.station_id;
      }
      if (r.wind_gust != null && r.wind_gust > maxGust) maxGust = r.wind_gust;
      if (r.temperature != null) {
        if (r.temperature < minTemp) minTemp = r.temperature;
        if (r.temperature > maxTemp) maxTemp = r.temperature;
      }
      if (r.humidity != null) { humSum += r.humidity; humCount++; }
    }

    // Buoy data (last 2h)
    const buoyRes = await db.query<{
      station_name: string; wave_height: number | null; water_temp: number | null;
    }>(`
      SELECT DISTINCT ON (station_id)
        station_name, wave_height, water_temp
      FROM buoy_readings
      WHERE time > NOW() - INTERVAL '2 hours'
        AND (wave_height IS NOT NULL OR water_temp IS NOT NULL)
      ORDER BY station_id, time DESC
    `);

    let maxWave = 0, maxWaveStation = '', waterTemp: number | null = null;
    for (const b of buoyRes.rows) {
      if (b.wave_height != null && b.wave_height > maxWave) {
        maxWave = b.wave_height;
        maxWaveStation = b.station_name;
      }
      if (b.water_temp != null && waterTemp === null) waterTemp = b.water_temp;
    }

    return {
      name: sector.name,
      stationCount: readings.length,
      maxWindKt: Math.round(msToKnots(maxWind)),
      maxGustKt: Math.round(msToKnots(maxGust)),
      maxWindStation,
      tempMin: minTemp < 999 ? Math.round(minTemp * 10) / 10 : null,
      tempMax: maxTemp > -999 ? Math.round(maxTemp * 10) / 10 : null,
      avgHumidity: humCount > 0 ? Math.round(humSum / humCount) : null,
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

function buildMessage(sectors: (SectorSummary | null)[]): string {
  const now = new Date();
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  let msg = '*Resumen diario MeteoMapGal*\n';
  msg += `${days[now.getDay()]} ${now.getDate()} de ${months[now.getMonth()]}\n\n`;

  for (const s of sectors) {
    if (!s) continue;

    msg += `*${s.name}*\n`;
    msg += `${s.stationCount} estaciones activas\n`;

    if (s.tempMin != null && s.tempMax != null) {
      msg += `Temp: ${s.tempMin}° - ${s.tempMax}°C\n`;
    }
    if (s.avgHumidity != null) {
      msg += `Humedad: ${s.avgHumidity}%\n`;
    }
    if (s.maxWindKt > 0) {
      msg += `Viento max: ${s.maxWindKt}kt`;
      if (s.maxGustKt > s.maxWindKt) msg += ` (racha ${s.maxGustKt}kt)`;
      msg += '\n';
    }
    if (s.maxWaveHeight != null) {
      msg += `Olas: ${s.maxWaveHeight.toFixed(1)}m (${s.maxWaveStation})\n`;
    }
    if (s.waterTemp != null) {
      msg += `Agua: ${s.waterTemp.toFixed(1)}°C\n`;
    }
    msg += '\n';
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

  // Only between 9:00-9:59
  if (hour !== SUMMARY_HOUR) return;

  // Already sent today
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

  const message = buildMessage([rias, embalse]);
  const ok = await sendToN8n(message);

  if (ok) {
    lastSummaryDate = todayStr;
    log.ok('Daily summary sent to Telegram');
  } else {
    log.warn('Daily summary failed — will retry next cycle');
  }
}
