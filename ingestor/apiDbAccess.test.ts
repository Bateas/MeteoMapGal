/**
 * The API runs with its own database user (meteomap_api, prepared for infra on 29-oct): it may write only
 * what visitors send and read only the tables below. A table the API starts to use without its grant
 * fails only in production (development connects with the ingestor's user), so this test reads every
 * module the API loads and fails when its SQL reads or writes a table that is not granted. Then: ask
 * infra for the grant (the line is in the failure message) and add it to GRANTS. It also fails when a
 * granted table is no longer used, so the grants stay the least the API needs.
 *
 * Limits, on purpose: it reads SQL written as literals (all of ours is) and only knows the relations
 * declared in schema.sql plus EXTERNAL. A table created somewhere else is invisible to it until it is
 * listed there.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

type Op = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

/** What meteomap_api is granted. Keep in step with the SQL given to infra. */
const GRANTS: Record<string, Op[]> = {
  // What visitors send
  field_reports: ['SELECT', 'INSERT'],
  storm_predictions: ['INSERT', 'SELECT'], // SELECT only on (time, sector): what its ON CONFLICT reads
  push_subscriptions: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  // Read only
  active_fires: ['SELECT'], beta_signals: ['SELECT'], buoy_readings: ['SELECT'], convection_grid_hourly: ['SELECT'],
  effis_fires: ['SELECT'], field_observers: ['SELECT'], lightning_strikes: ['SELECT'], magic_windows: ['SELECT'],
  metar_reports: ['SELECT'], mg_aux_readings: ['SELECT'], ml_models: ['SELECT'], ml_predictions: ['SELECT'],
  readings: ['SELECT'], spot_scores: ['SELECT'], station_calibration: ['SELECT'], stations: ['SELECT'],
  upper_air_hourly: ['SELECT'], webcam_readings: ['SELECT'],
  // TimescaleDB aggregates: they inherit nothing from their tables
  readings_hourly: ['SELECT'], buoy_readings_hourly: ['SELECT'], lightning_hourly_zone: ['SELECT'],
  convection_daily_sector: ['SELECT'], ica_daily_station: ['SELECT'],
};

/** Relations the API reads that schema.sql does not create: the ML container makes them. */
const EXTERNAL = ['ml_models', 'ml_predictions'];

/** Writes inside modules the API loads that the API never runs (checked below where it can be). */
const NOT_RUN_BY_THE_API: Array<{ file: string; table: string; why: string }> = [
  { file: 'ingestor/db.ts', table: 'readings', why: 'batch writers of the ingestor; the API only opens the pool' },
  { file: 'ingestor/db.ts', table: 'stations', why: 'same' },
  { file: 'ingestor/db.ts', table: 'buoy_readings', why: 'same' },
  { file: 'ingestor/db.ts', table: 'webcam_readings', why: 'same' },
  { file: 'ingestor/effisFetcher.ts', table: 'effis_fires', why: 'the API imports only its attribution and province helpers' },
  { file: 'ingestor/forecastArchive.ts', table: 'forecast_archive', why: 'the API calls stopForecastArchive() at start' },
];

const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const relOf = (abs: string) => path.relative(ROOT, abs).split(path.sep).join('/');

/** Every .ts module the API loads, following relative imports (static, export-from and dynamic). */
function apiModules(): string[] {
  const seen = new Set<string>();
  const walk = (abs: string) => {
    if (seen.has(abs)) return;
    seen.add(abs);
    const src = readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/(?:import|export)[^'"`;]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const base = path.resolve(path.dirname(abs), (m[1] ?? m[2]).replace(/\.js$/, ''));
      const found = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find((c) => existsSync(c));
      if (found) walk(found);
    }
  };
  walk(path.join(ROOT, 'ingestor/api.ts'));
  return [...seen].map(relOf);
}

/** The string literals of a file that hold SQL (backtick or single-quoted, uppercase keywords). */
function sqlLiterals(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/`((?:[^`\\]|\\.)*)`|'((?:[^'\\\n]|\\.)*)'/g)) {
    const s = m[1] ?? m[2];
    if (/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/.test(s)) out.push(s);
  }
  return out;
}

function relations(): Set<string> {
  const schema = read('ingestor/schema.sql');
  const names = [...schema.matchAll(/CREATE (?:TABLE|MATERIALIZED VIEW|VIEW)(?: IF NOT EXISTS)? ([a-z_][a-z0-9_]*)/g)].map((m) => m[1]);
  return new Set([...names, ...EXTERNAL]);
}

/** `fromWrite`: needed by a write statement (its WHERE, RETURNING or ON CONFLICT), not by a plain read. */
interface Use { table: string; op: Op; file: string; fromWrite?: boolean }

function apiUses(): Use[] {
  const known = relations();
  const uses: Use[] = [];
  for (const file of apiModules()) {
    for (const sql of sqlLiterals(read(file))) {
      for (const m of sql.matchAll(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_][a-z0-9_]*)/g)) {
        const table = m[2];
        const op: Op = m[1] === 'INSERT INTO' ? 'INSERT' : m[1] === 'UPDATE' ? 'UPDATE' : 'DELETE';
        uses.push({ table, op, file });
        // ON CONFLICT ... DO UPDATE needs UPDATE. SELECT is needed by a WHERE or RETURNING on a write and,
        // in PG 16, by every ON CONFLICT with a target (it reads those columns), DO NOTHING included:
        // the first SQL for infra (29-oct) granted storm_predictions only INSERT and missed it.
        if (op === 'INSERT' && /\bDO UPDATE\b/.test(sql)) uses.push({ table, op: 'UPDATE', file, fromWrite: true });
        const readsColumns = /\bRETURNING\b/.test(sql) || /\bON CONFLICT\s*(\(|ON CONSTRAINT)/.test(sql) || (op !== 'INSERT' && /\bWHERE\b/.test(sql));
        if (readsColumns) uses.push({ table, op: 'SELECT', file, fromWrite: true });
      }
      for (const m of sql.matchAll(/(?<!DELETE\s+)\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/g)) {
        if (known.has(m[1])) uses.push({ table: m[1], op: 'SELECT', file });
      }
    }
  }
  return uses.filter((u) => !NOT_RUN_BY_THE_API.some((x) => x.file === u.file && x.table === u.table && (u.op !== 'SELECT' || u.fromWrite)));
}

describe('the API database user (meteomap_api)', () => {
  const uses = apiUses();

  it('finds the modules and the SQL it should (the scan itself works)', () => {
    const modules = apiModules();
    expect(modules).toContain('ingestor/api.ts');
    expect(modules).toContain('ingestor/queries.ts');
    expect(uses.some((u) => u.table === 'field_reports' && u.op === 'INSERT')).toBe(true);
    expect(uses.some((u) => u.table === 'readings' && u.op === 'SELECT')).toBe(true);
  });

  it('every table it writes or reads is granted for that operation', () => {
    const missing = [...new Set(uses.filter((u) => !(GRANTS[u.table] ?? []).includes(u.op))
      .map((u) => `GRANT ${u.op} ON ${u.table} TO meteomap_api;   -- used in ${u.file}`))];
    expect(missing, `The API uses tables meteomap_api cannot touch. Ask infra for these, then add them to GRANTS:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every grant is still used (the least the API needs)', () => {
    const used = new Set(uses.map((u) => `${u.table}:${u.op}`));
    const unused = Object.entries(GRANTS).flatMap(([t, ops]) => ops.filter((op) => !used.has(`${t}:${op}`)).map((op) => `${op} ON ${t}`));
    expect(unused, `Granted but no longer used (ask infra to revoke, then remove from GRANTS): ${unused.join(', ')}`).toEqual([]);
  });

  it('the writes it loads but never runs stay that way', () => {
    const api = read('ingestor/api.ts');
    const importsFrom = (mod: string) => [...api.matchAll(new RegExp(`import \\{([^}]*)\\} from '\\./${mod}\\.js'`, 'g'))]
      .flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
    expect(importsFrom('db').sort()).toEqual(['closePool', 'getPool', 'initPool', 'pingDb']);
    expect(importsFrom('effisFetcher').some((n) => /^run|insert|write/i.test(n))).toBe(false);
    expect(api).toMatch(/\bstopForecastArchive\(\);/);
  });
});
