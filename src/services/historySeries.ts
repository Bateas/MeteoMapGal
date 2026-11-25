/**
 * What the Historial tab says about a station or a buoy: which magnitudes it really has, their series,
 * and the sentence that goes before the chart. Pure.
 *
 * Reads three shapes of row without the caller caring: raw readings, the hourly aggregates and the buoy
 * rows, whose fields have other names (see ingestor/queries.ts). Hourly buoy rows carry no salinity or
 * dew point: the aggregate on the server does not keep them.
 */
import { msToKnots } from './windUtils';
import { windDrift, type WindDrift } from './windTrendService';

export type HistoryRow = object;

export interface HistoryMetric {
  key: string;
  label: string;
  unit: string;
  digits: number;
  /** Field names, first one with a value wins */
  fields: readonly string[];
  /** Drawn thin on the same chart and named in its line: the gust of the wind, the highest wave of the sea */
  companion?: { fields: readonly string[]; word: string };
  /** The value to show from the stored one */
  convert?: (v: number) => number;
  /** A magnitude whose minimum says nothing (radiation at night): «hasta X». */
  peakOnly?: boolean;
  /** A reading all at zero is a sensor with nothing to say */
  zeroIsEmpty?: boolean;
  /** Change between the last 45 min and the time before that counts as going up or down */
  driftMin: number;
}

const WIND_FIELDS = ['wind_speed', 'avg_wind'];
const GUST_FIELDS = ['wind_gust', 'max_gust'];

const wind: HistoryMetric = {
  key: 'wind', label: 'Viento', unit: 'kt', digits: 0, fields: WIND_FIELDS, convert: msToKnots,
  companion: { fields: GUST_FIELDS, word: 'racha' }, driftMin: 2,
};
const humidity: HistoryMetric = { key: 'humidity', label: 'Humedad', unit: '%', digits: 0, fields: ['humidity', 'avg_humidity'], driftMin: 5 };
const dewPoint: HistoryMetric = { key: 'dew', label: 'Punto de rocío', unit: '°C', digits: 1, fields: ['dew_point', 'avg_dew_point'], driftMin: 0.5 };

export const STATION_METRICS: readonly HistoryMetric[] = [
  wind,
  { key: 'temp', label: 'Temperatura', unit: '°C', digits: 1, fields: ['temperature', 'avg_temp'], driftMin: 0.5 },
  humidity,
  { key: 'pressure', label: 'Presión', unit: 'hPa', digits: 0, fields: ['pressure', 'avg_pressure'], driftMin: 1 },
  dewPoint,
  { key: 'solar', label: 'Radiación', unit: 'W/m²', digits: 0, fields: ['solar_rad', 'avg_solar_rad'], peakOnly: true, zeroIsEmpty: true, driftMin: 100 },
];

export const BUOY_METRICS: readonly HistoryMetric[] = [
  {
    key: 'wave', label: 'Ola', unit: 'm', digits: 1, fields: ['wave_height', 'avg_wave_height'],
    companion: { fields: ['wave_height_max', 'max_wave_height'], word: 'máxima' }, driftMin: 0.2,
  },
  { key: 'period', label: 'Periodo de la ola', unit: 's', digits: 0, fields: ['wave_period', 'avg_wave_period'], driftMin: 1 },
  wind,
  { key: 'water', label: 'Agua', unit: '°C', digits: 1, fields: ['water_temp', 'avg_water_temp'], driftMin: 0.2 },
  { key: 'air', label: 'Aire', unit: '°C', digits: 1, fields: ['air_temp', 'avg_air_temp'], driftMin: 0.5 },
  { key: 'salinity', label: 'Salinidad', unit: 'PSU', digits: 1, fields: ['salinity'], driftMin: 0.3 },
  { key: 'level', label: 'Nivel del mar', unit: 'm', digits: 2, fields: ['sea_level', 'avg_sea_level'], driftMin: 0.1 },
  { key: 'current', label: 'Corriente', unit: 'cm/s', digits: 0, fields: ['current_speed', 'avg_current'], convert: (v) => v * 100, driftMin: 5 },
  { key: 'pressure', label: 'Presión', unit: 'hPa', digits: 0, fields: ['air_pressure', 'avg_pressure'], driftMin: 1 },
  humidity,
  dewPoint,
];

/**
 * A tide gauge is in the harbour: its level is what it is for, and the «wave» it reports (0,02 m on 4-nov) is the
 * water of the dock, not the state of the sea. So it offers neither that nor its period.
 */
export const GAUGE_METRICS: readonly HistoryMetric[] = [
  BUOY_METRICS.find((m) => m.key === 'level')!,
  ...BUOY_METRICS.filter((m) => m.key !== 'level' && m.key !== 'wave' && m.key !== 'period'),
];

/** The sentinel of the sources for a missing value, and any wild reading like it */
const MIN_REAL_VALUE = -900;

/** «2026-11-04 00:20:00+01», what the database sends: Safari reads none of it unless it is written as ISO. */
export function parseDbTime(text: string): number {
  const iso = text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  return new Date(iso).getTime();
}

const rowTime = (row: HistoryRow): number | null => {
  const r = row as { time?: string; bucket?: string };
  const text = r.time ?? r.bucket;
  if (!text) return null;
  const t = parseDbTime(text);
  return Number.isFinite(t) ? t : null;
};

function readField(row: HistoryRow, fields: readonly string[]): number | null {
  const r = row as Record<string, unknown>;
  for (const f of fields) {
    const v = r[f];
    if (typeof v === 'number' && Number.isFinite(v) && v > MIN_REAL_VALUE) return v;
  }
  return null;
}

/** Only the magnitudes this station really sent in these rows, in the order of the table. */
export function availableMetrics(rows: readonly HistoryRow[], table: readonly HistoryMetric[]): HistoryMetric[] {
  return table.filter((m) => rows.some((row) => {
    const v = readField(row, m.fields);
    return v != null && (!m.zeroIsEmpty || v > 0);
  }));
}

export interface SeriesPoint {
  t: number;
  v: number;
  /** The thin line: the highest of the bucket */
  top?: number;
}

const MAX_CHART_POINTS = 300;

/**
 * The series of one magnitude, oldest first. A platform can come from two sources at the same minute (they
 * are separate rows): they become one point. Long ranges go down to what a 320 px chart can draw, with the
 * mean of each stretch and the highest of its peak.
 */
export function seriesOf(rows: readonly HistoryRow[], metric: HistoryMetric, maxPoints = MAX_CHART_POINTS): SeriesPoint[] {
  const conv = metric.convert ?? ((v: number) => v);
  const byTime = new Map<number, SeriesPoint>();
  for (const row of rows) {
    const t = rowTime(row);
    if (t == null) continue;
    const raw = readField(row, metric.fields);
    const rawTop = metric.companion ? readField(row, metric.companion.fields) : null;
    if (raw == null) continue;
    const point: SeriesPoint = { t, v: conv(raw) };
    if (rawTop != null) point.top = conv(rawTop);
    byTime.set(t, point);
  }
  const points = [...byTime.values()].sort((a, b) => a.t - b.t);
  if (points.length <= maxPoints) return points;

  const size = points.length / maxPoints;
  const out: SeriesPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const chunk = points.slice(Math.floor(i * size), Math.floor((i + 1) * size));
    if (chunk.length === 0) continue;
    const point: SeriesPoint = {
      t: chunk[Math.floor(chunk.length / 2)].t,
      v: chunk.reduce((s, p) => s + p.v, 0) / chunk.length,
    };
    const tops = chunk.filter((p) => p.top != null).map((p) => p.top!);
    if (tops.length > 0) point.top = Math.max(...tops);
    out.push(point);
  }
  return out;
}

const figure = (v: number, digits: number) => v.toFixed(digits).replace('.', ',').replace(/^-0(,0+)?$/, '0$1');

/** «14 kt», «12,3 °C», «65 %». */
export function formatValue(v: number, metric: HistoryMetric): string {
  return `${figure(v, metric.digits)} ${metric.unit}`;
}

export interface SeriesRange {
  min: number;
  max: number;
  top: number | null;
}

export function rangeOf(series: readonly SeriesPoint[]): SeriesRange | null {
  if (series.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let top: number | null = null;
  for (const p of series) {
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
    if (p.top != null && (top == null || p.top > top)) top = p.top;
  }
  return { min, max, top };
}

/** «de 8,8 a 15,1 °C», and the thin line when it adds something. What a row of the table reads. */
export function rangeWords(series: readonly SeriesPoint[], metric: HistoryMetric): string | null {
  const range = rangeOf(series);
  if (!range) return null;
  const { min, max, top } = range;
  const low = figure(min, metric.digits);
  const high = figure(max, metric.digits);
  let text: string;
  if (metric.peakOnly) text = `hasta ${formatValue(max, metric)}`;
  else if (low === high) text = formatValue(max, metric);
  else text = `de ${low} a ${formatValue(max, metric)}`;
  if (metric.companion && top != null && top > max) text += `, ${metric.companion.word} ${figure(top, metric.digits)}`;
  return text;
}

/** Past this the last point is not «ahora» */
const NOW_MAX_MIN = 90;
const DRIFT_RECENT_MS = 45 * 60_000;
const DRIFT_BEFORE_MS = 75 * 60_000;

/**
 * Where a magnitude is going. The wind goes through windDrift, the one definition the rows and the cards use.
 * The others compare the same two stretches with the change that means something for each.
 */
export function driftOf(series: readonly SeriesPoint[], metric: HistoryMetric, now: number): WindDrift | null {
  if (metric.key === 'wind') return windDrift(series.map((p) => ({ t: p.t, kt: p.v })), now);
  const recent: number[] = [];
  const before: number[] = [];
  for (const p of series) {
    const age = now - p.t;
    if (age < 0) continue;
    if (age <= DRIFT_RECENT_MS) recent.push(p.v);
    else if (age <= DRIFT_RECENT_MS + DRIFT_BEFORE_MS) before.push(p.v);
  }
  if (recent.length < 2 || before.length < 2) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const diff = mean(recent) - mean(before);
  if (diff >= metric.driftMin) return 'sube';
  if (diff <= -metric.driftMin) return 'baja';
  return 'estable';
}

const DRIFT_PHRASE: Record<WindDrift, string> = { sube: 'sube', baja: 'baja', estable: 'se mantiene' };

/**
 * The conclusion before the chart: «En 24 h: de 8,8 a 15,1 °C. Ahora 12,3 °C y baja.» What is not known is
 * not said, and a last reading from a while ago says it is not from now.
 */
export function historySentence(
  series: readonly SeriesPoint[],
  metric: HistoryMetric,
  periodWords: string,
  now: number,
): string | null {
  const words = rangeWords(series, metric);
  const last = series[series.length - 1];
  if (!words || !last) return null;
  const head = `${periodWords}: ${words}.`;
  const ageMin = (now - last.t) / 60_000;
  if (ageMin > NOW_MAX_MIN) return head;
  const drift = driftOf(series, metric, now);
  const value = formatValue(last.v, metric);
  return `${head} Ahora ${value}${drift ? ` y ${DRIFT_PHRASE[drift]}` : ''}.`;
}

/** The whole of one reading, for the line under the chart when the pointer is on it */
export function nearestPoint(series: readonly SeriesPoint[], t: number): SeriesPoint | null {
  let best: SeriesPoint | null = null;
  let bestGap = Infinity;
  for (const p of series) {
    const gap = Math.abs(p.t - t);
    if (gap < bestGap) { best = p; bestGap = gap; }
  }
  return best;
}
