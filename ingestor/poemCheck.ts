/**
 * Before switching Puertos del Estado to POEM: does POEM give the same numbers
 * PORTUSSRV gave? Read-only. Run on the server, in the ingestor folder, with
 * POEM_TOKEN already in .env and BEFORE restarting the ingestor:
 *
 *   node --import tsx poemCheck.ts
 *
 * 1. Prints, per station, the table and columns POEM holds it in (factor,
 *    unit, quality flag, description) — what the ingestor will read.
 * 2. Fetches the last 12 h from POEM and the rows PORTUSSRV gave us for the
 *    same hours (buoy_readings, source 'portus'), and compares them field by
 *    field at the same minute. Same database behind both: they should match.
 * 3. Counts the quality flags POEM attaches to each column.
 *
 * Never prints the token; only when it expires. A few dozen GETs to POEM and
 * one SELECT per station on buoy_readings.
 */
import 'dotenv/config';
import { initPool, getPool, closePool } from './db.js';
import { poemGet, poemToken, PoemHttpError } from './poemClient.js';
import { discoverPoemPlans } from './buoyFetcher.js';
import { planRequestColumns, poemRowToReading, poemRows, poemIsoUtc, poemFechaMs, jwtExpiryMs, type PoemField } from './poemLogic.js';

const STATIONS = [
  { id: 2248, name: 'Cabo Silleiro', type: 'REDEXT' },
  { id: 3220, name: 'Vilagarcía (marea)', type: 'REDMAR' },
  { id: 3221, name: 'Vigo (marea)', type: 'REDMAR' },
  { id: 3223, name: 'Marín (marea)', type: 'REDMAR' },
  { id: 4271, name: 'Lourizán', type: 'REMPOR' },
  { id: 4272, name: 'Ons', type: 'REMPOR' },
  { id: 4273, name: 'Cabo Udra', type: 'REMPOR' },
];

const WINDOW_H = 12;

const DB_COLUMN: Record<PoemField, string> = {
  waveHeight: 'wave_height', waveHeightMax: 'wave_height_max', wavePeriod: 'wave_period',
  wavePeriodMean: 'wave_period_mean', waveDir: 'wave_dir', windSpeed: 'wind_speed', windDir: 'wind_dir',
  windGust: 'wind_gust', waterTemp: 'water_temp', airTemp: 'air_temp', airPressure: 'air_pressure',
  currentSpeed: 'current_speed', currentDir: 'current_dir', salinity: 'salinity', seaLevel: 'sea_level',
  humidity: 'humidity',
};

function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 0.005);
}

async function main(): Promise<void> {
  const token = poemToken();
  if (!token) {
    console.log('Falta POEM_TOKEN en .env. Nada que comprobar.');
    return;
  }
  const exp = jwtExpiryMs(token);
  console.log(exp
    ? `Token: caduca el ${new Date(exp).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}${exp < Date.now() ? ' (YA CADUCADO)' : ''}`
    : 'Token: no dice cuando caduca');

  const plans = await discoverPoemPlans(STATIONS, token);
  initPool();
  const db = getPool();
  const now = Date.now();
  let allOk = true;

  for (const s of STATIONS) {
    const plan = plans.get(s.id);
    console.log(`\n== ${s.name} (${s.id}, ${s.type})`);
    if (!plan) {
      console.log('   SIN PLAN: POEM no tiene esta estacion en una tabla de tiempo real que usemos (o falta el permiso).');
      allOk = false;
      continue;
    }
    console.log(`   tabla ${plan.table}`);
    for (const c of plan.columns) {
      console.log(`   ${c.column.padEnd(6)} → ${c.field.padEnd(15)} /${c.factor} ${c.unit ?? '(sin unidad)'} qc=${c.qcColumn ?? '-'}  ${c.description ?? ''}`);
    }

    let data: unknown;
    try {
      data = await poemGet(`/doris/${plan.table}`, {
        codigo: String(s.id),
        'fecha.ge': poemIsoUtc(now - WINDOW_H * 3_600_000),
        OrderBy: 'fecha.desc',
        Limit: '1000',
        Columns: planRequestColumns(plan).join(','),
      }, token);
    } catch (err) {
      console.log(`   ERROR leyendo datos: ${(err as Error).message}${err instanceof PoemHttpError && err.status === 403 ? ' (sin permiso para esta tabla)' : ''}`);
      allOk = false;
      continue;
    }
    const rows = poemRows(data);
    console.log(`   POEM: ${rows.length} filas en ${WINDOW_H} h`);

    // Quality flags as POEM sends them, per column.
    const qcCount = new Map<string, Map<string, number>>();
    for (const r of rows) {
      for (const c of plan.columns) {
        if (!c.qcColumn || r[c.column] == null) continue;
        const m = qcCount.get(c.column) ?? new Map<string, number>();
        const k = String(r[c.qcColumn]);
        m.set(k, (m.get(k) ?? 0) + 1);
        qcCount.set(c.column, m);
      }
    }
    for (const [col, m] of qcCount) {
      console.log(`   qc ${col}: ${[...m.entries()].map(([k, n]) => `${k}=${n}`).join(' ')}`);
    }

    // POEM rows by minute, parsed exactly as the ingestor will.
    const poemByMinute = new Map<number, Record<string, number | null>>();
    for (const r of rows) {
      const t = poemFechaMs(r.fecha);
      if (t == null) continue;
      const { reading } = poemRowToReading(plan, s.name, r, t, Number.POSITIVE_INFINITY);
      if (reading) poemByMinute.set(Math.round(t / 60_000), reading as unknown as Record<string, number | null>);
    }

    const fields = [...new Set(plan.columns.map((c) => c.field))];
    const res = await db.query(
      `SELECT time, ${Object.values(DB_COLUMN).join(', ')}
         FROM buoy_readings
        WHERE station_id = $1 AND source = 'portus' AND time > now() - make_interval(hours => $2::int)
        ORDER BY time`,
      [s.id, WINDOW_H],
    );
    let matched = 0;
    const stats = new Map<string, { n: number; eq: number; maxDiff: number; onlyDb: number; onlyPoem: number }>();
    for (const dbRow of res.rows) {
      const minute = Math.round(new Date(dbRow.time).getTime() / 60_000);
      const p = poemByMinute.get(minute);
      if (!p) continue;
      matched++;
      for (const f of Object.keys(DB_COLUMN) as PoemField[]) {
        const st = stats.get(f) ?? { n: 0, eq: 0, maxDiff: 0, onlyDb: 0, onlyPoem: 0 };
        const dv = dbRow[DB_COLUMN[f]] == null ? null : Number(dbRow[DB_COLUMN[f]]);
        const pv = p[f] ?? null;
        if (dv != null && pv != null) {
          st.n++;
          if (same(pv, dv)) st.eq++;
          st.maxDiff = Math.max(st.maxDiff, Math.abs(pv - dv));
        } else if (dv != null) st.onlyDb++;
        else if (pv != null) st.onlyPoem++;
        stats.set(f, st);
      }
    }
    console.log(`   PORTUSSRV guardado: ${res.rows.length} filas; a la misma hora que POEM: ${matched}`);
    for (const [f, st] of stats) {
      if (st.n === 0 && st.onlyDb === 0 && st.onlyPoem === 0) continue;
      const pct = st.n ? Math.round((100 * st.eq) / st.n) : 0;
      const flag = (st.n && pct < 95) || st.onlyDb > 0.05 * matched ? '  <-- REVISAR' : '';
      if (flag) allOk = false;
      console.log(`   ${f.padEnd(15)} iguales ${st.eq}/${st.n} (${pct} %), max dif ${st.maxDiff.toFixed(3)}, solo PORTUSSRV ${st.onlyDb}, solo POEM ${st.onlyPoem}${flag}`);
    }
    if (matched === 0) {
      console.log('   Ninguna fila a la misma hora: no se puede comparar esta estacion.');
      allOk = false;
    }
    if (!fields.length) allOk = false;
  }

  console.log(allOk
    ? '\nRESULTADO: POEM da lo mismo que PORTUSSRV. Se puede reiniciar el ingestor.'
    : '\nRESULTADO: hay diferencias o huecos (marcados arriba). NO reiniciar todavia: revisar antes.');
  await closePool();
}

main().catch(async (err) => {
  console.error('poemCheck fallo:', (err as Error).message);
  await closePool().catch(() => {});
  process.exit(1);
});
