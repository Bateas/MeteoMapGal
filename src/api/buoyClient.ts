/**
 * Buoy client for the map: reads the buoys from our own API (/api/v1/buoys/latest),
 * where the ingestor stores them already merged. The browser never asks Puertos del
 * Estado: their data are read by our service through POEM (ingestor/poemClient.ts),
 * the access they set for third parties, and PORTUSSRV is not used from here at all.
 * The Xunta buoys go through our proxy (observatorioCosteiro.ts), development only.
 */

import { fetchWithRetry } from './fetchWithRetry';

// ── Types ──────────────────────────────────────────────

export interface BuoyReading {
  stationId: number;
  stationName: string;
  timestamp: string;
  // Wave
  waveHeight: number | null;       // Hm0 (m)
  waveHeightMax: number | null;    // Hmax (m)
  wavePeriod: number | null;       // Tp (s)
  wavePeriodMean: number | null;   // Tm02 (s)
  waveDir: number | null;          // MeanDir (deg)
  // Wind
  windSpeed: number | null;        // m/s
  windDir: number | null;          // deg (from)
  windGust: number | null;         // m/s (REMPOR only)
  // Temperature
  waterTemp: number | null;        // °C
  airTemp: number | null;          // °C
  // Pressure
  airPressure: number | null;      // hPa
  // Currents
  currentSpeed: number | null;     // m/s (API returns cm/s, divided by 100 in parser)
  currentDir: number | null;       // deg
  // Salinity
  salinity: number | null;         // PSU
  // Sea level (tide gauges)
  seaLevel: number | null;         // m (PORTUS says "unidad":"m")
  // Observatorio Costeiro-exclusive fields
  humidity: number | null;         // % — only from Observatorio Costeiro
  dewPoint: number | null;         // °C — only from Observatorio Costeiro
  /** Data source: 'portus' (default) or 'obscosteiro' (Observatorio Costeiro da Xunta) */
  source?: 'portus' | 'obscosteiro';
}

/**
 * Who publishes a buoy's data. Each provider asks to be named wherever its data
 * are shown; Puertos del Estado, in writing on 1-oct-2026, with the address of
 * its portal.
 */
export type BuoyProvider = 'pde' | 'xunta';

export const BUOY_PROVIDERS: Record<BuoyProvider, { name: string; url?: string; urlLabel?: string }> = {
  pde: { name: 'Puertos del Estado', url: 'https://portus.puertos.es/', urlLabel: 'portus.puertos.es' },
  xunta: { name: 'Observatorio Costeiro da Xunta' },
};

/** Predefined stations for Rías Baixas sector — all 3 Rías covered */
export const RIAS_BUOY_STATIONS: {
  id: number; name: string; lat: number; lon: number; type: string; enabled?: boolean;
  /** Where its readings come from (the ingestor merges both when a platform is in both). */
  providers: BuoyProvider[];
}[] = [
  // The CETMAR moorings are not asked to Puertos del Estado (ingestor/buoyFetcher.ts):
  // the same buoys arrive from the Xunta, and only from the Xunta.
  // ── Exterior / Atlántico ──
  { id: 2248, name: 'Cabo Silleiro',      lat: 42.12, lon: -9.43, type: 'REDEXT', providers: ['pde'] },
  { id: 1253, name: 'A Guarda',           lat: 41.90, lon: -8.90, type: 'CETMAR', providers: ['xunta'] },
  // ── Ría de Vigo ──
  { id: 1252, name: 'Islas Cíes',         lat: 42.17, lon: -8.91, type: 'CETMAR', enabled: false, providers: ['xunta'] }, // OFFLINE since Dec 2025 (same physical station as ObsCosteiro 15002)
  { id: 1251, name: 'Rande (Ría Vigo)',   lat: 42.29, lon: -8.66, type: 'CETMAR', providers: ['xunta'] },
  { id: 3221, name: 'Vigo (marea)',       lat: 42.24, lon: -8.73, type: 'REDMAR', providers: ['pde'] },
  // ── Ría de Pontevedra ──
  { id: 4272, name: 'Ons',                lat: 42.38, lon: -8.94, type: 'REMPOR', providers: ['pde'] },
  { id: 4273, name: 'Cabo Udra',          lat: 42.34, lon: -8.83, type: 'REMPOR', providers: ['pde'] },
  { id: 4271, name: 'Lourizán',           lat: 42.41, lon: -8.66, type: 'REMPOR', providers: ['pde'] },
  { id: 3223, name: 'Marín (marea)',      lat: 42.41, lon: -8.69, type: 'REDMAR', providers: ['pde'] },
  // ── Ría de Arousa ──
  { id: 1250, name: 'Cortegada (Arousa)', lat: 42.63, lon: -8.78, type: 'CETMAR', providers: ['xunta'] },
  { id: 1255, name: 'Ribeira',            lat: 42.55, lon: -8.95, type: 'CETMAR', providers: ['xunta'] },
  { id: 3220, name: 'Vilagarcía (marea)', lat: 42.60, lon: -8.77, type: 'REDMAR', providers: ['pde'] },
  // ── Ría de Muros-Noia (Observatorio Costeiro only) ──
  { id: 15009, name: 'Muros',             lat: 42.7195, lon: -9.0153, type: 'OBSCOSTEIRO', providers: ['xunta'] },
];

/** The providers behind these buoys, Puertos del Estado first; unknown ids add nothing. */
export function buoyProviders(stationIds: Iterable<number>): BuoyProvider[] {
  const found = new Set<BuoyProvider>();
  for (const id of stationIds) {
    for (const p of RIAS_BUOY_STATIONS.find((s) => s.id === id)?.providers ?? []) found.add(p);
  }
  return (['pde', 'xunta'] as const).filter((p) => found.has(p));
}

/** Pre-built coordinates lookup for all buoy stations (shared across components) */
export const BUOY_COORDS_MAP = new Map(
  RIAS_BUOY_STATIONS.map((s) => [s.id, { lat: s.lat, lon: s.lon }]),
);

// ── Our own copy ──────────────────────────────────────────────

/** A row of /api/v1/buoys/latest: the merged reading, as stored. */
interface StoredBuoyRow {
  time: string;
  station_id: number;
  station_name: string | null;
  source: string | null;
  wave_height: number | null;
  wave_height_max: number | null;
  wave_period: number | null;
  wave_period_mean: number | null;
  wave_dir: number | null;
  wind_speed: number | null;
  wind_dir: number | null;
  wind_gust: number | null;
  water_temp: number | null;
  air_temp: number | null;
  air_pressure: number | null;
  current_speed: number | null;
  current_dir: number | null;
  salinity: number | null;
  sea_level: number | null;
  humidity: number | null;
  dew_point: number | null;
}

/** "2026-09-23 08:40:00+02" → a timestamp every browser parses the same way. */
function storedTimeToIso(time: string): string {
  const withT = time.replace(' ', 'T');
  const withOffset = withT.replace(/([+-]\d{2})$/, '$1:00');
  const parsed = new Date(withOffset);
  return Number.isNaN(parsed.getTime()) ? time : parsed.toISOString();
}

export function storedRowToReading(row: StoredBuoyRow): BuoyReading {
  return {
    stationId: row.station_id,
    stationName: row.station_name ?? String(row.station_id),
    timestamp: storedTimeToIso(row.time),
    waveHeight: row.wave_height,
    waveHeightMax: row.wave_height_max,
    wavePeriod: row.wave_period,
    wavePeriodMean: row.wave_period_mean,
    waveDir: row.wave_dir,
    windSpeed: row.wind_speed,
    windDir: row.wind_dir,
    windGust: row.wind_gust,
    waterTemp: row.water_temp,
    airTemp: row.air_temp,
    airPressure: row.air_pressure,
    currentSpeed: row.current_speed,
    currentDir: row.current_dir,
    salinity: row.salinity,
    seaLevel: row.sea_level,
    humidity: row.humidity,
    dewPoint: row.dew_point,
    source: row.source === 'obscosteiro' ? 'obscosteiro' : 'portus',
  };
}

/**
 * The buoys as our own service already stores them: one request instead of
 * eleven, already merged with the coastal observatory, and no traffic to
 * Puertos del Estado from the visitor's browser. They publish every 10 to 60
 * minutes and rate-limit by address, so a busy day used to mean every open
 * tab asking them for all eleven stations, from the same address the
 * round-the-clock collection goes out by.
 */
export async function fetchStoredBuoys(): Promise<BuoyReading[]> {
  const response = await fetchWithRetry('/api/v1/buoys/latest', {
    label: 'Buoys (own API)',
    timeout: 10_000,
    maxRetries: 1,
  });
  if (!response.ok) throw new Error(`Buoys API error: ${response.status}`);
  const data = (await response.json()) as { readings?: StoredBuoyRow[] };
  return (data.readings ?? []).map(storedRowToReading);
}
