/**
 * Station Data Logger
 *
 * Persists every weather reading to localStorage as CSV rows.
 * This builds a local historical database of real station data over time,
 * since MeteoGalicia has no historical API.
 *
 * Key stations for thermal analysis at Embalse de Castrelo:
 * - mg_10045 EVEGA Leiro (105m) - at the reservoir
 * - mg_10142 Remuíño (120m) - near the reservoir
 * - aemet_1690B RIBADAVIA (112m) - official AEMET station
 * - mc_ESGAL3200000032170A Prado (Ribadavia) - Meteoclimatic
 * - mg_10064 Cequeliños (187m) - south of reservoir
 *
 * Storage: localStorage key 'meteomap_station_log'
 * Format: CSV with header: timestamp,stationId,stationName,source,windSpeed,windDirection,temperature,humidity
 *
 * To prevent localStorage bloat:
 * - Only logs one reading per station per 10 minutes
 * - Auto-prunes data older than 90 days
 * - Max ~5MB (localStorage limit is typically 5-10MB)
 */

import type { NormalizedReading } from '../types/station';
import { escapeCSV } from './csvUtils';

const STORAGE_KEY = 'meteomap_station_log';
const HEADER = 'timestamp,stationId,windSpeed,windDirection,temperature,humidity,pressure';
const MIN_INTERVAL_MS = 10 * 60 * 1000; // 10 min between logs per station
const MAX_AGE_DAYS = 90;

// Track last log time per station to avoid duplicates
const lastLogTime = new Map<string, number>();

/**
 * Log an array of readings to localStorage CSV.
 * Deduplicates by station (max 1 per 10 min).
 */
export function logReadings(readings: NormalizedReading[]): void {
  const now = Date.now();
  const newRows: string[] = [];

  for (const r of readings) {
    // Skip if we logged this station recently
    const lastTime = lastLogTime.get(r.stationId) ?? 0;
    if (now - lastTime < MIN_INTERVAL_MS) continue;

    // Only log if we have at least wind or temperature data
    if (r.windSpeed === null && r.temperature === null) continue;

    const ts = r.timestamp instanceof Date ? r.timestamp.toISOString() : new Date(r.timestamp).toISOString();
    const row = [
      ts,
      escapeCSV(r.stationId),
      r.windSpeed?.toFixed(2) ?? '',
      r.windDirection?.toFixed(0) ?? '',
      r.temperature?.toFixed(1) ?? '',
      r.humidity?.toFixed(0) ?? '',
      r.pressure?.toFixed(1) ?? '',
    ].join(',');

    newRows.push(row);
    lastLogTime.set(r.stationId, now);
  }

  if (newRows.length === 0) return;

  // Append to existing data
  let existing = localStorage.getItem(STORAGE_KEY) ?? HEADER;
  existing += '\n' + newRows.join('\n');

  // Prune old data if needed
  const pruned = pruneOldData(existing);

  try {
    localStorage.setItem(STORAGE_KEY, pruned);
  } catch {
    // localStorage full - prune more aggressively
    console.warn('[DataLogger] Storage full, pruning to 30 days');
    const aggressivePrune = pruneOldData(existing, 30);
    try {
      localStorage.setItem(STORAGE_KEY, aggressivePrune);
    } catch {
      console.error('[DataLogger] Cannot save even after aggressive prune');
    }
  }
}

/**
 * Remove rows older than maxDays.
 */
function pruneOldData(csv: string, maxDays = MAX_AGE_DAYS): string {
  const lines = csv.split('\n');
  const header = lines[0];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxDays);
  const cutoffStr = cutoff.toISOString();

  const kept = lines.slice(1).filter(line => {
    if (!line.trim()) return false;
    // First field is ISO timestamp
    const ts = line.split(',')[0];
    return ts >= cutoffStr;
  });

  return header + '\n' + kept.join('\n');
}

/**
 * Get the total number of logged readings.
 */
export function getLogStats(): { totalRows: number; sizeKB: number; oldestDate: string | null; stations: string[] } {
  const csv = localStorage.getItem(STORAGE_KEY);
  if (!csv) return { totalRows: 0, sizeKB: 0, oldestDate: null, stations: [] };

  const lines = csv.split('\n').filter(l => l.trim() && !l.startsWith('timestamp'));
  const stations = new Set<string>();
  let oldest: string | null = null;

  for (const line of lines) {
    const parts = line.split(',');
    if (parts[1]) stations.add(parts[1]);
    if (parts[0] && (!oldest || parts[0] < oldest)) oldest = parts[0];
  }

  return {
    totalRows: lines.length,
    sizeKB: Math.round(new Blob([csv]).size / 1024),
    oldestDate: oldest,
    stations: [...stations],
  };
}

/**
 * Export logged data as a downloadable CSV file.
 */
export function exportLogAsCSV(): void {
  const csv = localStorage.getItem(STORAGE_KEY);
  if (!csv) {
    console.warn('[DataLogger] No data to export');
    return;
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meteomap_log_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Clear all logged data.
 */
export function clearLog(): void {
  localStorage.setItem(STORAGE_KEY, HEADER);
  lastLogTime.clear();
}
