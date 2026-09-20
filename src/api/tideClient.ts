/**
 * Tide data client — IHM (Instituto Hidrográfico de la Marina)
 *
 * Free, no-auth JSON API for official Spanish tide predictions.
 * Covers all major Rías Baixas ports: Vigo, Marín, Vilagarcía, Baiona, etc.
 *
 * API: https://ideihm.covam.es/api-ihm/getmarea
 */

export interface TidePoint {
  /** HH:MM in local Spanish time (Europe/Madrid) */
  time: string;
  /** Meters above chart datum */
  height: number;
  /** 'pleamar' (high) or 'bajamar' (low) */
  type: 'high' | 'low';
  /** Local date string YYYY-MM-DD */
  date?: string;
  /** Timestamp in ms (UTC) */
  epochMs?: number;
  /** Original raw UTC time HH:MM from IHM */
  rawUtc?: string;
}

export interface TideStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface TideData {
  station: TideStation;
  date: string;
  points: TidePoint[];
  fetchedAt: Date;
}

// ── Rías Baixas tide stations (IHM IDs) ──────────────────
// Cover all 3 Rías: Vigo, Pontevedra, Arousa (sector center -8.68, 42.30, r=40km)

export const RIAS_TIDE_STATIONS: TideStation[] = [
  { id: '29', name: 'Vigo',       lat: 42.240, lon: -8.730 },
  { id: '28', name: 'Marín',      lat: 42.410, lon: -8.690 },
  { id: '26', name: 'Vilagarcía', lat: 42.600, lon: -8.770 },
  { id: '30', name: 'Baiona',     lat: 42.118, lon: -8.845 },
  { id: '27', name: 'Sanxenxo',   lat: 42.397, lon: -8.805 },
];

// Default station (closest to sector center)
export const DEFAULT_TIDE_STATION = RIAS_TIDE_STATIONS[0]; // Vigo

import { fetchWithRetry } from './fetchWithRetry';

const IHM_BASE = '/ihm-api';

/** Format a Date object to local HH:MM in Europe/Madrid timezone */
export function formatToLocalHHMM(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const h = parts.find((p) => p.type === 'hour')?.value ?? String(date.getHours()).padStart(2, '0');
    const m = parts.find((p) => p.type === 'minute')?.value ?? String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  } catch {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
}

/** Format a Date object to local YYYY-MM-DD in Europe/Madrid timezone */
export function formatToLocalDate(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const mo = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && mo && d) return `${y}-${mo}-${d}`;
  } catch {
    // fallback
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Fetch tide predictions for a station and date.
 * Converts IHM UTC predictions to local Spanish time (CEST/CET) with absolute timestamps.
 * Returns high/low tide points with times and heights.
 */
export async function fetchTidePredictions(
  stationId: string = DEFAULT_TIDE_STATION.id,
  date?: Date
): Promise<TidePoint[]> {
  const params = new URLSearchParams({
    request: 'gettide',
    id: stationId,
    format: 'json',
  });

  const queryDate = date ?? new Date();
  const yyyy = queryDate.getFullYear();
  const mm = String(queryDate.getMonth() + 1).padStart(2, '0');
  const dd = String(queryDate.getDate()).padStart(2, '0');
  params.set('date', `${yyyy}${mm}${dd}`);

  const url = `${IHM_BASE}/api-ihm/getmarea?${params}`;

  const response = await fetchWithRetry(url, {
    label: 'Tide',
    timeout: 10_000,
    maxRetries: 2,
  });

  if (!response.ok) {
    throw new Error(`IHM API error: ${response.status}`);
  }

  const data = await response.json();

  // Parse IHM response format
  const mareas = data?.mareas;
  if (!mareas?.datos?.marea) {
    return [];
  }

  const baseFecha = mareas.fecha || `${yyyy}-${mm}-${dd}`;

  const points: TidePoint[] = [];
  const rawList = Array.isArray(mareas.datos.marea)
    ? mareas.datos.marea
    : [mareas.datos.marea];

  for (const m of rawList) {
    if (!m.hora || m.altura == null) continue;

    let localTime = m.hora;
    let epochMs: number | undefined;
    let localDateStr: string | undefined;

    const [hh, min] = m.hora.split(':').map(Number);
    const [y, mo, d] = baseFecha.split('-').map(Number);

    if (
      Number.isFinite(hh) &&
      Number.isFinite(min) &&
      Number.isFinite(y) &&
      Number.isFinite(mo) &&
      Number.isFinite(d)
    ) {
      // IHM reports times strictly in UTC (huso 0).
      // Construct UTC date and convert to Spanish local time (CEST in summer / CET in winter).
      const utcDate = new Date(Date.UTC(y, mo - 1, d, hh, min, 0));
      epochMs = utcDate.getTime();
      localTime = formatToLocalHHMM(utcDate);
      localDateStr = formatToLocalDate(utcDate);
    }

    points.push({
      time: localTime,
      height: parseFloat(m.altura),
      type: m.tipo === 'pleamar' ? 'high' : 'low',
      date: localDateStr,
      epochMs,
      rawUtc: m.hora,
    });
  }

  return points;
}

/**
 * Fetch today + tomorrow tides for a station.
 * Returns combined data for a 48h view partitioned by local calendar days.
 */
export async function fetchTides48h(
  stationId: string = DEFAULT_TIDE_STATION.id
): Promise<{ today: TidePoint[]; tomorrow: TidePoint[] }> {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [yesterdayPts, todayPts, tomorrowPts] = await Promise.all([
    fetchTidePredictions(stationId, yesterday).catch(() => []),
    fetchTidePredictions(stationId, now),
    fetchTidePredictions(stationId, tomorrow),
  ]);

  const all = [...yesterdayPts, ...todayPts, ...tomorrowPts];
  const seen = new Set<string>();
  const uniquePoints: TidePoint[] = [];

  for (const p of all) {
    const key = p.epochMs ? String(p.epochMs) : `${p.date || ''}_${p.time}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePoints.push(p);
    }
  }
  uniquePoints.sort((a, b) => (a.epochMs || 0) - (b.epochMs || 0));

  const todayStr = formatToLocalDate(now);
  const tomorrowStr = formatToLocalDate(tomorrow);

  const today = uniquePoints.filter((p) => p.date === todayStr);
  const tomorrowList = uniquePoints.filter((p) => p.date === tomorrowStr);

  return {
    today: today.length > 0 ? today : todayPts,
    tomorrow: tomorrowList.length > 0 ? tomorrowList : tomorrowPts,
  };
}
