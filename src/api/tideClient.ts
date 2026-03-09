/**
 * Tide data client — IHM (Instituto Hidrográfico de la Marina)
 *
 * Free, no-auth JSON API for official Spanish tide predictions.
 * Covers all major Rías Baixas ports: Vigo, Marín, Vilagarcía, Baiona, etc.
 *
 * API: https://ideihm.covam.es/api-ihm/getmarea
 */

export interface TidePoint {
  /** HH:MM */
  time: string;
  /** Meters above chart datum */
  height: number;
  /** 'pleamar' (high) or 'bajamar' (low) */
  type: 'high' | 'low';
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

const IHM_BASE = '/ihm-api';

/**
 * Fetch tide predictions for a station and date.
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

  if (date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    params.set('date', `${yyyy}${mm}${dd}`);
  }

  const url = `${IHM_BASE}/api-ihm/getmarea?${params}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
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

  const points: TidePoint[] = [];
  const rawList = Array.isArray(mareas.datos.marea)
    ? mareas.datos.marea
    : [mareas.datos.marea];

  for (const m of rawList) {
    points.push({
      time: m.hora,
      height: parseFloat(m.altura),
      type: m.tipo === 'pleamar' ? 'high' : 'low',
    });
  }

  return points;
}

/**
 * Fetch today + tomorrow tides for a station.
 * Returns combined data for a 48h view.
 */
export async function fetchTides48h(
  stationId: string = DEFAULT_TIDE_STATION.id
): Promise<{ today: TidePoint[]; tomorrow: TidePoint[] }> {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [today, tmrw] = await Promise.all([
    fetchTidePredictions(stationId, now),
    fetchTidePredictions(stationId, tomorrow),
  ]);

  return { today, tomorrow: tmrw };
}
