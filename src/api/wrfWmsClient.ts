/**
 * WRF WMS client for MeteoGalicia THREDDS
 *
 * Uses the WRF 4km (d03) model from MeteoGalicia's THREDDS WMS endpoint.
 * Two model runs per day: 00Z and 12Z, 96h forecast, hourly steps.
 *
 * IMPORTANT: CORS is not enabled on MeteoGalicia THREDDS,
 * so all requests go through the Vite proxy `/thredds-wms`.
 */

import type { WrfVariable } from '../store/weatherLayerStore';

// ── Configuration ──────────────────────────────────────────

/** WMS proxy base path (rewritten to /thredds/wms by Vite) */
const WMS_BASE = '/thredds-wms';

/** WRF 4km dataset path template. {RUN} = e.g. "20260227_0000" */
const WRF_DATASET = (run: string) =>
  `wrf_2d_04km/fmrc/files/${run.slice(0, 8)}/wrf_arw_det_history_d03_${run}.nc4`;

/** Bounding box for Ourense area (slightly larger than map extent) */
const OURENSE_BBOX = {
  west: -8.6,
  south: 42.0,
  east: -7.5,
  north: 42.6,
};

/** WMS image dimensions */
const WMS_WIDTH = 512;
const WMS_HEIGHT = 512;

/** Map WRF variable IDs to THREDDS WMS layer names */
const LAYER_MAP: Record<WrfVariable, string> = {
  prec: 'prec',
  cft: 'cft',
  mod: 'mod',
  rh: 'rh',
  cape: 'cape',
  visibility: 'visibility',
};

/** Default color scale ranges per variable */
const SCALE_RANGES: Record<WrfVariable, [number, number]> = {
  prec: [0, 20],
  cft: [0, 1],
  mod: [0, 20],
  rh: [0, 100],
  cape: [0, 2000],
  visibility: [0, 50000],
};

// ── Model run resolver ─────────────────────────────────────

/**
 * Determine the latest available WRF model run.
 * Runs at 00Z and 12Z. Data becomes available ~4h after run start.
 * Returns format: "YYYYMMDD_HH00" e.g. "20260227_0000"
 */
export function resolveModelRun(now = new Date()): { primary: string; fallback: string } {
  const utcH = now.getUTCHours();
  const today = formatDateUTC(now);
  const yesterday = formatDateUTC(new Date(now.getTime() - 86400_000));

  // 00Z run available after ~04Z, 12Z run available after ~16Z
  if (utcH >= 16) {
    return { primary: `${today}_1200`, fallback: `${today}_0000` };
  }
  if (utcH >= 4) {
    return { primary: `${today}_0000`, fallback: `${yesterday}_1200` };
  }
  // Before 04Z: yesterday's 12Z run is latest
  return { primary: `${yesterday}_1200`, fallback: `${yesterday}_0000` };
}

function formatDateUTC(d: Date): string {
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
  ].join('');
}

// ── Time steps ─────────────────────────────────────────────

/**
 * Generate time steps for a WRF model run (96h, hourly).
 * Returns Date objects + human-readable Spanish labels.
 */
export function generateTimeSteps(modelRun: string): { time: Date; label: string }[] {
  const year = parseInt(modelRun.slice(0, 4), 10);
  const month = parseInt(modelRun.slice(4, 6), 10) - 1;
  const day = parseInt(modelRun.slice(6, 8), 10);
  const hour = parseInt(modelRun.slice(9, 11), 10);

  const runStart = new Date(Date.UTC(year, month, day, hour));
  const now = new Date();
  const todayStr = now.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

  const steps: { time: Date; label: string }[] = [];
  for (let h = 0; h <= 96; h++) {
    const t = new Date(runStart.getTime() + h * 3600_000);
    // Skip past times (keep at least the current hour)
    if (t.getTime() < now.getTime() - 3600_000) continue;

    const dayLabel = t.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });
    const timeLabel = t.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const isToday = t.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) === todayStr;

    steps.push({
      time: t,
      label: isToday ? `Hoy ${timeLabel}` : `${dayLabel} ${timeLabel}`,
    });
  }

  return steps;
}

// ── WMS URL builder ────────────────────────────────────────

export interface WmsUrlParams {
  modelRun: string;
  variable: WrfVariable;
  time: Date;
  width?: number;
  height?: number;
}

/**
 * Build a GetMap WMS URL for the given parameters.
 * Returns a URL string that goes through the Vite THREDDS proxy.
 */
export function buildWmsUrl(params: WmsUrlParams): string {
  const { modelRun, variable, time, width = WMS_WIDTH, height = WMS_HEIGHT } = params;

  const dataset = WRF_DATASET(modelRun);
  const layer = LAYER_MAP[variable];
  const range = SCALE_RANGES[variable];
  const timeStr = time.toISOString();

  const bbox = `${OURENSE_BBOX.west},${OURENSE_BBOX.south},${OURENSE_BBOX.east},${OURENSE_BBOX.north}`;

  const searchParams = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetMap',
    LAYERS: layer,
    CRS: 'EPSG:4326',
    SRS: 'EPSG:4326',
    BBOX: bbox,
    WIDTH: String(width),
    HEIGHT: String(height),
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
    STYLES: 'boxfill/rainbow',
    COLORSCALERANGE: `${range[0]},${range[1]}`,
    TIME: timeStr,
  });

  return `${WMS_BASE}/${dataset}?${searchParams.toString()}`;
}

/**
 * Get the geographic extent for the WMS image source.
 * MapLibre image source needs [topLeft, topRight, bottomRight, bottomLeft] as [lon, lat].
 */
export function getWmsImageCoordinates(): [[number, number], [number, number], [number, number], [number, number]] {
  const { west, south, east, north } = OURENSE_BBOX;
  return [
    [west, north],  // top-left
    [east, north],  // top-right
    [east, south],  // bottom-right
    [west, south],  // bottom-left
  ];
}

/**
 * Fetch WMS GetCapabilities to validate a model run exists.
 * Returns true if the dataset responds, false otherwise.
 */
export async function validateModelRun(modelRun: string): Promise<boolean> {
  try {
    const dataset = WRF_DATASET(modelRun);
    const url = `${WMS_BASE}/${dataset}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Resolve the best available model run, with fallback.
 * Returns the model run string and generated time steps.
 */
export async function resolveAvailableRun(): Promise<{
  modelRun: string;
  timeSteps: { time: Date; label: string }[];
} | null> {
  const { primary, fallback } = resolveModelRun();

  // Try primary run first
  if (await validateModelRun(primary)) {
    return { modelRun: primary, timeSteps: generateTimeSteps(primary) };
  }

  // Fall back to previous run
  if (await validateModelRun(fallback)) {
    return { modelRun: fallback, timeSteps: generateTimeSteps(fallback) };
  }

  return null;
}
