/**
 * Guard: MeteoGalicia's 2 m wind stays a SHADOW.
 *
 * It is archived (mg_aux_readings) and shown in the popup of its own station, said as what it is:
 * wind among the crops, not the wind on the water. It is NOT validated, so it must not reach the
 * verdicts, the consensus, the map arrows, the wind field, the ticker or the alerts.
 *
 * The rule here is a closed list: every non-test source file that names the 2 m data (table,
 * endpoint, client, component or MeteoGalicia's 2 m codes) must be one of the files below. Anything
 * new that starts reading it fails this test; widening the list is a product decision, made only
 * once an exam against field truths validates the data.
 */
import { describe, it, expect } from 'vitest';

// Node modules through a string variable, as in repoGuards.test.ts: the app tsconfig carries no
// Node types, and the test always runs under Node.
const [fsModule, pathModule, urlModule] = ['node:fs', 'node:path', 'node:url'];
const { readdirSync, readFileSync, existsSync } = await import(/* @vite-ignore */ fsModule);
const { join, dirname, relative, sep } = await import(/* @vite-ignore */ pathModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);

const root: string = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Anything that names the 2 m data or the way to it. */
const SHADOW_PATTERN = /mg_aux|mgaux|mg-aux|aux2m|aux_2m|wind_2m|gust_2m|VV_AVG_2m|VV_RACHA_2m|DV_AVG_2m/i;

/** The only files allowed to name it. */
const ALLOWED = new Set([
  // parse and archive (ingestor), never turned into a reading
  'src/api/mgAux2m.ts',
  'ingestor/fetchers.ts',
  'ingestor/index.ts',
  'ingestor/mgAuxArchive.ts',
  // read side: one endpoint, one client, one line in the station popup
  'ingestor/mgAuxLatest.ts',
  'ingestor/api.ts',
  'src/api/mgAuxLatestClient.ts',
  'src/components/map/StationAux2mLine.tsx',
  'src/components/map/StationPopup.tsx',
]);

/** Surfaces that must never see it, named so the failure reads clearly. */
const FORBIDDEN = [
  'src/services/spotScoringEngine.ts',
  'src/services/idwInterpolation.ts',
  'src/services/normalizer.ts',
  'src/store/weatherStore.ts',
  'src/components/map/WindFieldOverlay.tsx',
  'src/components/map/StationSymbolLayer.tsx',
  'src/components/map/ReadingsLayers.tsx',
  'src/components/common/ConditionsTicker.tsx',
  'ingestor/analyzer.ts',
  'ingestor/engineShadow.ts',
  'ingestor/alertDispatcher.ts',
];

const isTest = (p: string) => /\.test\.tsx?$/.test(p);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }) as { name: string; isDirectory(): boolean }[]) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

describe('MeteoGalicia 2 m wind stays a shadow', () => {
  const files = [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, 'ingestor'))].filter((f) => !isTest(f));

  it('only the allowed files name it', () => {
    const offenders = files.filter((f) => !ALLOWED.has(f) && SHADOW_PATTERN.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('the engine, consensus, arrows, wind field, ticker and alerts never see it', () => {
    const present = FORBIDDEN.filter((f) => existsSync(join(root, f)));
    expect(present.length).toBe(FORBIDDEN.length); // a rename must update this list, not empty it
    expect(present.filter((f) => SHADOW_PATTERN.test(read(f)))).toEqual([]);
  });

  it('the popup client and line write to no store', () => {
    for (const f of ['src/api/mgAuxLatestClient.ts', 'src/components/map/StationAux2mLine.tsx']) {
      expect(read(f)).not.toMatch(/from ['"][^'"]*\/store\//);
    }
  });

  it('the guard itself catches a file that starts reading it', () => {
    expect(SHADOW_PATTERN.test("import { fetchMgAuxLatest } from '../api/mgAuxLatestClient';")).toBe(true);
    expect(SHADOW_PATTERN.test('SELECT wind_2m FROM mg_aux_readings')).toBe(true);
    expect(SHADOW_PATTERN.test("import { StationAux2mLine } from './StationAux2mLine';")).toBe(true);
    expect(SHADOW_PATTERN.test('const wind = reading.windSpeed;')).toBe(false);
  });
});
