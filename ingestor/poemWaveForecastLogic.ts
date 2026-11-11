/**
 * Pure helpers for the archive of Puertos del Estado's nearshore wave forecast (poemWaveForecast.ts).
 * Values are kept AS SENT (integers): the factor and unit of the forecast table are not confirmed
 * by the provider yet, so nothing here converts them.
 */

/** Meshes kept: SAPO Vigo, SAPO Ria de Pontevedra and Rias Baixas. */
export const WAVE_MESHES = ['S22', 'S21', 'RBAI'] as const;

export interface WavePoint { code: number; mesh: string; lat: number; lon: number; kind: string | null }

export interface WaveForecastRow {
  code: number;
  mesh: string;
  runTime: Date;
  time: Date;
  mtHm0: number | null;
  mtTp: number | null;
  mtTm02: number | null;
  mtDmd: number | null;
  mf1Hm0: number | null;
  mvHm0: number | null;
  vvImd: number | null;
  vvDmd: number | null;
}

function rowsOf(payload: unknown): Record<string, unknown>[] {
  return Array.isArray(payload) ? (payload as Record<string, unknown>[]) : [];
}

function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

/** Mesh -> epoch seconds of its latest run, from /modelos/siwana/nombre_malla. */
export function meshRuns(payload: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rowsOf(payload)) {
    const mesh = typeof r.malla === 'string' ? r.malla.trim() : '';
    const run = int(r.fecha_ejec);
    if (mesh && run != null && run > 0) out.set(mesh, run);
  }
  return out;
}

export function meshPoints(payload: unknown): WavePoint[] {
  const out: WavePoint[] = [];
  for (const r of rowsOf(payload)) {
    const code = int(r.codigo);
    const mesh = typeof r.malla === 'string' ? r.malla.trim() : '';
    const lat = typeof r.latitud === 'number' ? r.latitud : NaN;
    const lon = typeof r.longitud === 'number' ? r.longitud : NaN;
    if (code == null || !mesh || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ code, mesh, lat, lon, kind: typeof r.tipo === 'string' ? r.tipo.trim() : null });
  }
  return out;
}

/** Rows of /modelos/siwana/wana_pred for one mesh and run. A row without code or hour is dropped. */
export function forecastRows(payload: unknown, meshOf: Map<number, string>, runEpochOf: Map<string, number>): WaveForecastRow[] {
  const out: WaveForecastRow[] = [];
  for (const r of rowsOf(payload)) {
    const code = int(r.codigo);
    const t = int(r.fecha);
    if (code == null || t == null || t <= 0) continue;
    const mesh = meshOf.get(code);
    const run = mesh ? runEpochOf.get(mesh) : undefined;
    if (!mesh || run == null) continue;
    out.push({
      code, mesh, runTime: new Date(run * 1000), time: new Date(t * 1000),
      mtHm0: int(r.mt_hm0), mtTp: int(r.mt_tp), mtTm02: int(r.mt_tm02), mtDmd: int(r.mt_dmd),
      mf1Hm0: int(r.mf1_hm0), mvHm0: int(r.mv_hm0), vvImd: int(r.vv_imd), vvDmd: int(r.vv_dmd),
    });
  }
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const COLS = 12;

export function forecastInsertParts(rows: WaveForecastRow[]): { tuples: string[]; values: unknown[] } {
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    values.push(r.code, r.mesh, r.runTime, r.time, r.mtHm0, r.mtTp, r.mtTm02, r.mtDmd, r.mf1Hm0, r.mvHm0, r.vvImd, r.vvDmd);
    return `(${Array.from({ length: COLS }, (_, k) => `$${i * COLS + k + 1}`).join(',')})`;
  });
  return { tuples, values };
}
